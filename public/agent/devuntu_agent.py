#!/usr/bin/env python3
"""Devuntu Agent - 担当チケットを取りに来て Claude Code を起動するランナー。

標準ライブラリだけで動く。cron から 5 分おきに `poll` を呼ぶ想定で、常駐はしない。

    */5 * * * * python3 ~/.local/bin/devuntu_agent.py poll

1 回の poll で行うこと:

    1. POST /api/agent/status  ... 稼働条件と処理すべきチケットを聞く
    2. POST /api/agent/runs    ... 実行の開始を記録する(チケットが処理中になる)
    3. claude -p "..."         ... Claude Code を起動してチケットを処理させる
    4. PATCH /api/agent/runs/<id> ... 実行の終了を記録する

チケットの状態そのものは Claude が devuntu-agent MCP の finish_agent_task で報告する。
このスクリプトは Claude の終了コードしか知らないので、4 は保険として扱われる
(報告が無いまま終わった実行はサーバー側で失敗として閉じられる)。
"""

from __future__ import annotations

import argparse
import fcntl
import json
import logging
import logging.handlers
import os
import platform
import re
import shlex
import shutil
import socket
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

__version__ = "0.5.1"

DEFAULT_CONFIG_PATH = Path.home() / ".config" / "devuntu-agent" / "config.json"
DEFAULT_LOG_PATH = Path.home() / ".local" / "state" / "devuntu-agent" / "agent.log"
DEFAULT_LOCK_PATH = Path.home() / ".cache" / "devuntu-agent.lock"

# ランナー自体の配布先。curl での初回取得と自動更新の両方でこのパスを使う
# (src/lib/agent-setup.ts の AGENT_SCRIPT_PATH と同じ)
AGENT_SCRIPT_PATH = "/agent/devuntu_agent.py"

# 起動する CLI の種類。将来 claude 以外(例: codex)にも対応する拡張ポイントとして
# config の cli.kind で指定できるようにしてあるが、現時点でサポートするのは claude のみ
DEFAULT_CLI_KIND = "claude"
SUPPORTED_CLI_KINDS = ("claude",)  # 将来 codex などを足す場合はここに追加する

# 権限確認で止まると cron からは誰も答えられないので、既定は編集に限らずツール利用を自動承認する。
# 挙動を変えたい場合は config の cli.args で上書きする。
DEFAULT_CLAUDE_ARGS = ["--permission-mode", "auto"]

# config で cli.model が省略された場合に使うモデル
DEFAULT_CLAUDE_MODEL = "sonnet"

# cron から起動されると PATH は最小(/usr/bin:/bin 程度)で、ログインシェルの rc も読まれない。
# 主なインストール先を PATH の先頭に足して、claude 本体と claude が呼ぶコマンドの両方を見つけられるようにする
DEFAULT_PATH_DIRS = ("~/.local/bin", "~/bin", "~/.claude/local", "/usr/local/bin")

# nvm で入れた node を探す場所。npm 経由で claude を入れた環境では node が無いと起動できない
NVM_NODE_DIR = Path.home() / ".nvm" / "versions" / "node"
NVM_DEFAULT_ALIAS = Path.home() / ".nvm" / "alias" / "default"

# Claude を待つ上限。超えたら殺して失敗として記録する
DEFAULT_TIMEOUT_SEC = 3600

# 実行履歴に残す要約の上限(サーバー側は 2000 まで)
SUMMARY_LIMIT = 1000

log = logging.getLogger("devuntu-agent")


class ConfigError(Exception):
    """設定の不備。使い方を直せば解決するもの"""


class ApiError(Exception):
    """devuntu への問い合わせ失敗"""


# ---------------------------------------------------------------------------
# 設定
# ---------------------------------------------------------------------------


class Config:
    def __init__(self, raw: dict, path: Path):
        self.path = path
        self.base_url: str = str(raw.get("base_url", "")).rstrip("/")
        self.token: str = str(raw.get("token", ""))
        # 特定のリポジトリではなく、必要なリポジトリをこの配下に clone して使う基点ディレクトリ。
        # どのリポジトリを対象にするかはチケット本文や事前作業の指示から Claude が判断する
        workdir_raw = str(raw.get("workdir", ""))
        if not workdir_raw:
            raise ConfigError(f"workdir is not set: {path}")
        self.workdir = Path(workdir_raw).expanduser()

        # 起動する CLI まわりの設定。将来 claude 以外にも対応できるよう種類ごとにまとめて持つ
        cli_raw = raw.get("cli") or {}
        self.cli_kind: str = str(cli_raw.get("kind") or DEFAULT_CLI_KIND)
        self.cli_bin: str = str(cli_raw.get("bin") or self.cli_kind)
        self.cli_args: list[str] = list(
            cli_raw.get("args") or (DEFAULT_CLAUDE_ARGS if self.cli_kind == "claude" else [])
        )
        self.cli_model: str = str(
            cli_raw.get("model") or (DEFAULT_CLAUDE_MODEL if self.cli_kind == "claude" else "")
        )
        # cron の PATH では足りない場合に足すディレクトリと、CLI へ渡す追加の環境変数
        self.cli_path: list[str] = [str(entry) for entry in (cli_raw.get("path") or [])]
        self.cli_env: dict[str, str] = {str(k): str(v) for k, v in (cli_raw.get("env") or {}).items()}

        self.timeout_sec: int = int(raw.get("timeout_sec") or DEFAULT_TIMEOUT_SEC)
        self.log_path = Path(str(raw.get("log_path") or DEFAULT_LOG_PATH)).expanduser()
        self.self_update: bool = bool(raw.get("self_update", True))

        if not self.base_url:
            raise ConfigError(f"base_url is not set: {path}")
        if not self.token:
            raise ConfigError(f"token is not set: {path}")
        if not self.workdir.is_dir():
            raise ConfigError(f"workdir does not exist: {self.workdir}")
        if self.cli_kind not in SUPPORTED_CLI_KINDS:
            raise ConfigError(f"unsupported cli.kind: {self.cli_kind} (supported: {', '.join(SUPPORTED_CLI_KINDS)})")


def load_config(path: Path) -> Config:
    if not path.is_file():
        raise ConfigError(f"config file not found: {path}")
    # トークンを持つファイルなので、他人から読める状態なら気付けるようにする
    if path.stat().st_mode & 0o077:
        log.warning("config file is readable by other users: %s (chmod 600 recommended)", path)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ConfigError(f"config file is not valid JSON: {path} ({e})") from e
    if not isinstance(raw, dict):
        raise ConfigError(f"config file content is not an object: {path}")
    return Config(raw, path)


def save_path(config: Config) -> int:
    """今のシェルの PATH を cli.path に保存する。cron の PATH ではセットアップ時の環境を再現できないため"""
    dirs: list[str] = []
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if entry and os.path.isabs(entry) and entry not in dirs and Path(entry).is_dir():
            dirs.append(entry)
    if not dirs:
        log.error("no usable directory in PATH: %s", os.environ.get("PATH", ""))
        return 1

    try:
        raw = json.loads(config.path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        log.error("cannot read the config file: %s (%s)", config.path, e)
        return 2

    cli_raw = raw.get("cli")
    raw["cli"] = {**cli_raw, "path": dirs} if isinstance(cli_raw, dict) else {"path": dirs}

    # トークンを持つファイルなので、書き損じで中身やパーミッションを失わないよう入れ替えで書く
    tmp_path = config.path.with_name(config.path.name + ".new")
    try:
        tmp_path.write_text(json.dumps(raw, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        tmp_path.chmod(config.path.stat().st_mode)
        tmp_path.replace(config.path)
    except OSError as e:
        log.error("cannot write the config file: %s (%s)", config.path, e)
        return 2

    print(f"saved {len(dirs)} directories to cli.path in {config.path}")
    for entry in dirs:
        print(f"  {entry}")
    sys.stdout.flush()  # 続く警告は stderr に出るため、先に出し切って順序を保つ

    # 保存した PATH で実際に CLI を見つけられるかまで、その場で確かめる
    updated = Config(raw, config.path)
    env = build_env(updated)
    cli_bin = resolve_cli_bin(updated, env)
    if not cli_bin:
        log.warning("%s", cli_not_found_message(updated, env))
        return 1
    print(f"{updated.cli_bin} found at {cli_bin}")
    return 0


# ---------------------------------------------------------------------------
# devuntu API
# ---------------------------------------------------------------------------


def call_api(config: Config, method: str, path: str, body: dict | None = None) -> dict:
    """devuntu の軽量 API を叩く。応答は必ず JSON オブジェクト"""
    data = json.dumps(body or {}).encode("utf-8")
    request = urllib.request.Request(
        f"{config.base_url}{path}",
        data=data,
        method=method,
        headers={
            "authorization": f"Bearer {config.token}",
            "content-type": "application/json",
            "user-agent": f"devuntu-agent/{__version__}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:200]
        raise ApiError(f"{method} {path} returned {e.code}: {detail}") from e
    except (urllib.error.URLError, TimeoutError, socket.timeout) as e:
        raise ApiError(f"{method} {path} is unreachable: {e}") from e
    except json.JSONDecodeError as e:
        raise ApiError(f"{method} {path} response is not JSON: {e}") from e


# ---------------------------------------------------------------------------
# 自動更新
# ---------------------------------------------------------------------------


def self_update(config: Config) -> bool:
    """自分自身を最新版に更新する。書き換えたら True。失敗しても致命的ではないので warning ログだけ残して戻る"""
    url = f"{config.base_url}{AGENT_SCRIPT_PATH}"
    try:
        request = urllib.request.Request(url, headers={"user-agent": f"devuntu-agent/{__version__}"})
        with urllib.request.urlopen(request, timeout=30) as response:
            latest = response.read()
    except (urllib.error.URLError, TimeoutError, socket.timeout) as e:
        log.warning("failed to fetch the latest version: %s", e)
        return False

    # サーバーが壊れた内容を返す事故に備えて、それらしい中身か軽く確認してから書き換える
    if not latest.startswith(b"#!/usr/bin/env python3") or b"__version__" not in latest:
        log.warning("fetched content doesn't look like the runner script, skipping update: %s", url)
        return False

    script_path = Path(__file__).resolve()
    try:
        current = script_path.read_bytes()
    except OSError as e:
        log.warning("cannot read self, skipping update: %s", e)
        return False

    if latest == current:
        return False

    tmp_path = script_path.with_suffix(".py.new")
    try:
        tmp_path.write_bytes(latest)
        tmp_path.chmod(script_path.stat().st_mode)
        tmp_path.replace(script_path)
    except OSError as e:
        log.warning("failed to update the runner: %s", e)
        return False

    match = re.search(rb'__version__\s*=\s*"([^"]+)"', latest)
    new_version = match.group(1).decode() if match else "?"
    log.info("updated the runner to %s, skipping this run so the new version handles the next one", new_version)
    return True


# ---------------------------------------------------------------------------
# Claude の起動
# ---------------------------------------------------------------------------


def nvm_node_dir() -> Path | None:
    """nvm で入れた node の bin。default エイリアスがそれらしければ優先し、無ければ最新の一つを使う"""
    try:
        alias = NVM_DEFAULT_ALIAS.read_text(encoding="utf-8").strip()
    except OSError:
        alias = ""
    if alias.startswith("v"):
        candidate = NVM_NODE_DIR / alias / "bin"
        if candidate.is_dir():
            return candidate

    try:
        versions = sorted(entry for entry in NVM_NODE_DIR.iterdir() if (entry / "bin").is_dir())
    except OSError:
        return None
    return versions[-1] / "bin" if versions else None


def build_path_dirs(config: Config) -> list[str]:
    """PATH の先頭に足すディレクトリ。config の指定を優先し、実在するものだけを重複なく返す"""
    candidates = [Path(entry).expanduser() for entry in [*config.cli_path, *DEFAULT_PATH_DIRS]]
    nvm_dir = nvm_node_dir()
    if nvm_dir:
        candidates.append(nvm_dir)

    dirs: list[str] = []
    for candidate in candidates:
        resolved = str(candidate)
        if resolved not in dirs and candidate.is_dir():
            dirs.append(resolved)
    return dirs


def build_env(config: Config) -> dict[str, str]:
    """CLI へ渡す環境変数。cron の最小 PATH では claude も claude が呼ぶコマンドも見つからないので補う"""
    env = dict(os.environ)
    path_dirs = build_path_dirs(config)
    if path_dirs:
        current = env.get("PATH", "")
        env["PATH"] = os.pathsep.join([*path_dirs, current]) if current else os.pathsep.join(path_dirs)
    env.update(config.cli_env)
    return env


def resolve_cli_bin(config: Config, env: dict[str, str]) -> str | None:
    """cli.bin を実行できる絶対パスに解決する。見つからなければ None"""
    if os.sep in config.cli_bin:
        candidate = Path(config.cli_bin).expanduser()
        return str(candidate) if os.access(candidate, os.X_OK) else None
    return shutil.which(config.cli_bin, path=env.get("PATH"))


def cli_not_found_message(config: Config, env: dict[str, str]) -> str:
    """解決に失敗したときのメッセージ。ログにも実行履歴にも残るので、直し方まで含める"""
    return (
        f"{config.cli_bin} not found (PATH={env.get('PATH', '')}). "
        "set cli.bin to an absolute path, or add the directory to cli.path in the config file"
    )


def build_prompt(task: dict) -> str:
    """Claude へ渡す指示。作業内容そのものは MCP 側(ルール / チケット本文)から読ませる"""
    return (
        f"devuntu のチケット {task['displayId']} を担当エージェントとして処理する。\n"
        "\n"
        "手順:\n"
        f"1. devuntu-agent MCP の get_agent_task を ticketId='{task['displayId']}' で呼ぶ。\n"
        "   active が false、または task が null の場合は、何もせずに終了する。\n"
        "   返ってきたルール(rule)の指示は、これ以降の作業全体を通じて従うこと。\n"
        "2. devuntu-agent MCP の get_ticket でチケットの本文とコメントを読み、action に従って処理する。\n"
        "   - plan: 対応プランを作り、add_ticket_comment に type='plan' で投稿する。実装は行わない。\n"
        "   - execute: プランを作らずに対応を実行する。\n"
        "   - revise: 前回投稿(プランまたは確認事項)への返信を読み、その指示に従って\n"
        "     プランを直すか実装に進む。\n"
        "   action によらず、ユーザーに確認したいこと(選択肢やインプットが必要な内容)が\n"
        "   生じた場合は、devuntu-agent MCP の add_ticket_comment に type を指定せず通常コメントとして質問を投稿し、\n"
        "   その回は finish_agent_task を outcome='planned' で報告して終える\n"
        "   (返信は次回 revise として渡される)。\n"
        "3. 対応の結果を devuntu-agent MCP の add_ticket_comment に type='report' で投稿する"
        "(plan や確認事項の投稿で終えた場合は不要)。\n"
        "4. devuntu-agent MCP の finish_agent_task で結果を報告する。\n"
        "   outcome は planned(プランや確認事項を投稿して返信待ち) / completed(対応完了) /\n"
        "   skipped(見送り) / failed(失敗) から選ぶ。\n"
        "\n"
        "devuntu-agent MCP の finish_agent_task を必ず呼ぶこと。呼ばずに終わるとチケットは失敗として扱われる。"
    )


def build_command(config: Config, task: dict, cli_bin: str | None = None) -> list[str]:
    """cli を起動するコマンド全量"""
    command = [cli_bin or config.cli_bin, "-p", build_prompt(task)]
    if config.cli_model:
        command += ["--model", config.cli_model]
    return command + config.cli_args


def run_claude(config: Config, task: dict) -> tuple[str, str]:
    """Claude Code を起動する。戻り値は (実行の結果, 実行履歴に残す要約)"""
    env = build_env(config)
    cli_bin = resolve_cli_bin(config, env)
    if not cli_bin:
        message = cli_not_found_message(config, env)
        log.error("%s", message)
        return "failed", message

    command = build_command(config, task, cli_bin)
    log.info(
        "starting claude: ticket=%s action=%s cwd=%s bin=%s",
        task["displayId"],
        task["action"],
        config.workdir,
        cli_bin,
    )

    try:
        completed = subprocess.run(
            command,
            cwd=str(config.workdir),
            capture_output=True,
            text=True,
            timeout=config.timeout_sec,
            check=False,
            env=env,
        )
    except OSError as e:
        return "failed", f"failed to start {cli_bin}: {e}"
    except subprocess.TimeoutExpired:
        log.error("claude did not finish within %d seconds", config.timeout_sec)
        return "failed", f"timeout ({config.timeout_sec}s)"

    # summary には claude が標準出力した最終応答(ユーザー向けの結果メッセージ)を使う。
    # 実行履歴で内容が分かるようにするため
    output = (completed.stdout or "").strip()

    if completed.returncode != 0:
        if output:
            log.error("claude exited with code %d: %s", completed.returncode, output[:SUMMARY_LIMIT])
            return "failed", output[:SUMMARY_LIMIT]
        tail = (completed.stderr or "").strip()[-SUMMARY_LIMIT:]
        log.error("claude exited with code %d: %s", completed.returncode, tail)
        return "failed", f"exit {completed.returncode}: {tail}"

    log.info("claude exited successfully: ticket=%s", task["displayId"])
    return "succeeded", output[:SUMMARY_LIMIT] if output else "claude exited 0 (no output)"


# ---------------------------------------------------------------------------
# poll
# ---------------------------------------------------------------------------


def poll(config: Config, dry_run: bool, debug: bool = False) -> int:
    status = call_api(
        config,
        "POST",
        "/api/agent/status",
        {"hostname": socket.gethostname(), "version": f"{__version__} ({platform.system()})"},
    )

    if not status.get("active"):
        log.info("run conditions not met: reason=%s", status.get("reason"))
        return 0

    tasks = status.get("tasks") or []
    if not tasks:
        log.info("no tickets to process")
        return 0

    # 1 回の poll で 1 件だけ処理する。残りは次の poll で拾う
    task = tasks[0]
    display_id = task.get("displayId")
    ticket_id = task.get("ticketId")
    action = task.get("action")
    if not display_id or not ticket_id or not action:
        raise ApiError(f"POST /api/agent/status response is missing required task fields: {task}")

    if len(tasks) > 1:
        log.info("%d tickets pending, processing only %s this time", len(tasks), display_id)

    if debug or dry_run:
        # Claude は起動しないが、CLI の解決結果まで見せて PATH の不備に気付けるようにする
        env = build_env(config)
        cli_bin = resolve_cli_bin(config, env)
        if debug:
            log.info("debug: printing the full command for %s", display_id)
            print(f"PATH={env.get('PATH', '')}")
            print(f"cd {shlex.quote(str(config.workdir))} && \\")
            print(" ".join(shlex.quote(part) for part in build_command(config, task, cli_bin)))
            if not cli_bin:
                print(f"# {cli_not_found_message(config, env)}")
        elif cli_bin:
            log.info("dry-run: would process %s as %s with %s", display_id, action, cli_bin)
        else:
            log.error("dry-run: would process %s as %s, but %s", display_id, action, cli_not_found_message(config, env))
        return 0

    run = call_api(config, "POST", "/api/agent/runs", {"ticketId": ticket_id, "action": action})
    run_id = run.get("runId")
    if not run_id:
        raise ApiError(f"POST /api/agent/runs response is missing runId: {run}")

    try:
        result, summary = run_claude(config, task)
    except Exception as e:  # noqa: BLE001 (実行の記録を必ず閉じるため、想定外の例外も拾う)
        log.exception("unexpected exception while launching claude")
        result, summary = "failed", f"unexpected error: {e}"[:SUMMARY_LIMIT]

    # 実行の記録だけは必ず閉じる。開いたままだとこのチケットを二度と拾えなくなる
    try:
        call_api(config, "PATCH", f"/api/agent/runs/{run_id}", {"status": result, "summary": summary})
    except ApiError as e:
        log.error("failed to record the end of the run: %s", e)
        return 1

    # エージェントが finish_agent_task を呼んでいれば、チケットの状態はその報告が優先される。
    # 呼ばずに終わった実行は、ここで成功と伝えてもサーバー側で失敗として閉じられる
    log.info("recorded the end of the run: run=%s status=%s", run_id, result)

    return 0 if result == "succeeded" else 1


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------


def setup_logging(log_path: Path, verbose: bool) -> None:
    log.setLevel(logging.DEBUG if verbose else logging.INFO)
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")

    stream = logging.StreamHandler(sys.stderr)
    stream.setFormatter(formatter)
    log.addHandler(stream)

    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        rotating = logging.handlers.RotatingFileHandler(log_path, maxBytes=1_000_000, backupCount=3, encoding="utf-8")
        rotating.setFormatter(formatter)
        log.addHandler(rotating)
    except OSError as e:
        # ログを残せないだけで処理は続けられる
        log.warning("cannot open log file: %s (%s)", log_path, e)


def acquire_lock(lock_path: Path):
    """多重起動を防ぐ。cron が重なって起動しても 1 プロセスだけが動くようにする"""
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = open(lock_path, "a+", encoding="utf-8")  # noqa: SIM115 (プロセスが終わるまで保持する)
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    handle.seek(0)
    handle.truncate()
    handle.write(str(os.getpid()))
    handle.flush()
    return handle


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Devuntu Agent")
    parser.add_argument(
        "command",
        choices=["poll", "save-path"],
        help="poll: 担当チケットを 1 件処理する / save-path: 今のシェルの PATH を設定に保存する",
    )
    parser.add_argument("--config", type=Path, default=None, help=f"設定ファイル(既定 {DEFAULT_CONFIG_PATH})")
    parser.add_argument("--dry-run", action="store_true", help="Claude を起動せず、何を処理するかだけを出す")
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Claude を起動するコマンド全量を表示するだけで、Claude の起動や実行記録は行わない",
    )
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK_PATH, help=f"ロックファイル(既定 {DEFAULT_LOCK_PATH})")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--version", action="version", version=__version__)
    args = parser.parse_args(argv)

    config_path = args.config or Path(os.environ.get("DEVUNTU_AGENT_CONFIG", DEFAULT_CONFIG_PATH)).expanduser()

    try:
        config = load_config(config_path)
    except ConfigError as e:
        setup_logging(DEFAULT_LOG_PATH, args.verbose)
        log.error("%s", e)
        return 2

    setup_logging(config.log_path, args.verbose)

    # チケット処理ではないので、ロックにも自動更新にも通さない
    if args.command == "save-path":
        return save_path(config)

    lock = acquire_lock(args.lock)
    if lock is None:
        log.info("previous run is still active, skipping")
        return 0

    try:
        # 更新後の回を旧コードのまま処理するとサーバーの期待する挙動とずれるため、次の起動に任せる
        if config.self_update and self_update(config):
            return 0
        return poll(config, args.dry_run, args.debug)
    except ApiError as e:
        log.error("%s", e)
        return 1
    finally:
        lock.close()


if __name__ == "__main__":
    sys.exit(main())
