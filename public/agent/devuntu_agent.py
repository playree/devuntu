#!/usr/bin/env python3
"""Devuntu Agent - 担当チケットを取りに来て Claude Code を起動するランナー。

標準ライブラリだけで動く。cron から 5 分おきに `poll` を呼ぶ想定で、常駐はしない。

    */5 * * * * flock -n ~/.cache/devuntu-agent.lock python3 ~/.local/bin/devuntu_agent.py poll

1 回の poll で行うこと:

    1. POST /api/agent/status  ... 稼働条件と処理すべきチケットを聞く
    2. POST /api/agent/runs    ... 実行の開始を記録する(チケットが処理中になる)
    3. claude -p "..."         ... Claude Code を起動してチケットを処理させる
    4. PATCH /api/agent/runs/<id> ... 実行の終了を記録する

チケットの状態そのものは Claude が MCP の finish_agent_task で報告する。
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
import socket
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

__version__ = "0.1.0"

DEFAULT_CONFIG_PATH = Path.home() / ".config" / "devuntu-agent" / "config.json"
DEFAULT_LOG_PATH = Path.home() / ".local" / "state" / "devuntu-agent" / "agent.log"
DEFAULT_LOCK_PATH = Path.home() / ".cache" / "devuntu-agent.lock"

# 権限確認で止まると cron からは誰も答えられないので、既定は編集を自動承認する。
# 他のツールまで許可したい場合は config の claude_args で上書きする。
DEFAULT_CLAUDE_ARGS = ["--permission-mode", "acceptEdits"]

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
        self.workdir = Path(str(raw.get("workdir", ""))).expanduser()
        self.claude_bin: str = str(raw.get("claude_bin") or "claude")
        self.claude_args: list[str] = list(raw.get("claude_args") or DEFAULT_CLAUDE_ARGS)
        self.timeout_sec: int = int(raw.get("timeout_sec") or DEFAULT_TIMEOUT_SEC)
        self.log_path = Path(str(raw.get("log_path") or DEFAULT_LOG_PATH)).expanduser()

        if not self.base_url:
            raise ConfigError(f"base_url が設定されていない: {path}")
        if not self.token:
            raise ConfigError(f"token が設定されていない: {path}")
        if not str(self.workdir):
            raise ConfigError(f"workdir が設定されていない: {path}")
        if not self.workdir.is_dir():
            raise ConfigError(f"workdir が存在しない: {self.workdir}")


def load_config(path: Path) -> Config:
    if not path.is_file():
        raise ConfigError(f"設定ファイルが無い: {path}")
    # トークンを持つファイルなので、他人から読める状態なら気付けるようにする
    if path.stat().st_mode & 0o077:
        log.warning("設定ファイルが他ユーザーから読める: %s (chmod 600 を推奨)", path)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ConfigError(f"設定ファイルが JSON として読めない: {path} ({e})") from e
    if not isinstance(raw, dict):
        raise ConfigError(f"設定ファイルの中身がオブジェクトではない: {path}")
    return Config(raw, path)


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
        raise ApiError(f"{method} {path} が {e.code} を返した: {detail}") from e
    except (urllib.error.URLError, TimeoutError, socket.timeout) as e:
        raise ApiError(f"{method} {path} に到達できない: {e}") from e
    except json.JSONDecodeError as e:
        raise ApiError(f"{method} {path} の応答が JSON ではない: {e}") from e


# ---------------------------------------------------------------------------
# Claude の起動
# ---------------------------------------------------------------------------


def build_prompt(task: dict) -> str:
    """Claude へ渡す指示。作業内容そのものは MCP 側(事前作業 / チケット本文)から読ませる"""
    return (
        f"devuntu のチケット {task['displayId']} を担当エージェントとして処理する。\n"
        "\n"
        "手順:\n"
        f"1. devuntu MCP の get_agent_task を ticketId='{task['displayId']}' で呼ぶ。\n"
        "   active が false、または task が null の場合は、何もせずに終了する。\n"
        "2. 返ってきた事前作業(preTask)の指示に従う。\n"
        "3. get_ticket でチケットの本文とコメントを読み、action に従って処理する。\n"
        "   - plan: 対応プランを作り、add_ticket_comment に type='plan' で投稿する。実装は行わない。\n"
        "   - execute: プランを作らずに対応を実行する。\n"
        "   - revise: プランへの返信を読み、その指示に従ってプランを直すか実装に進む。\n"
        "4. get_agent_post_task を呼び、返ってきた事後作業(postTask)の指示に従う。\n"
        "5. 対応の結果を add_ticket_comment に type='report' で投稿する"
        "(plan で終えた場合は不要)。\n"
        "6. finish_agent_task で結果を報告する。\n"
        "   outcome は planned(プランを投稿して返信待ち) / completed(対応完了) /\n"
        "   skipped(見送り) / failed(失敗) から選ぶ。\n"
        "\n"
        "finish_agent_task を必ず呼ぶこと。呼ばずに終わるとチケットは失敗として扱われる。"
    )


def run_claude(config: Config, task: dict) -> tuple[str, str]:
    """Claude Code を起動する。戻り値は (実行の結果, 実行履歴に残す要約)"""
    command = [config.claude_bin, "-p", build_prompt(task), *config.claude_args]
    log.info("claude を起動する: ticket=%s action=%s cwd=%s", task["displayId"], task["action"], config.workdir)

    try:
        completed = subprocess.run(
            command,
            cwd=str(config.workdir),
            capture_output=True,
            text=True,
            timeout=config.timeout_sec,
            check=False,
        )
    except FileNotFoundError:
        return "failed", f"{config.claude_bin} が見つからない"
    except subprocess.TimeoutExpired:
        log.error("claude が %d 秒で終わらなかった", config.timeout_sec)
        return "failed", f"timeout ({config.timeout_sec}s)"

    if completed.returncode != 0:
        tail = (completed.stderr or completed.stdout or "").strip()[-SUMMARY_LIMIT:]
        log.error("claude が終了コード %d で終わった: %s", completed.returncode, tail)
        return "failed", f"exit {completed.returncode}: {tail}"

    log.info("claude が正常に終了した: ticket=%s", task["displayId"])
    return "succeeded", "claude exited 0"


# ---------------------------------------------------------------------------
# poll
# ---------------------------------------------------------------------------


def poll(config: Config, dry_run: bool) -> int:
    status = call_api(
        config,
        "POST",
        "/api/agent/status",
        {"hostname": socket.gethostname(), "version": f"{__version__} ({platform.system()})"},
    )

    if not status.get("active"):
        log.info("稼働条件を満たしていない: reason=%s", status.get("reason"))
        return 0

    tasks = status.get("tasks") or []
    if not tasks:
        log.info("処理するチケットは無い")
        return 0

    # 1 回の poll で 1 件だけ処理する。残りは次の poll で拾う
    task = tasks[0]
    display_id = task.get("displayId")
    ticket_id = task.get("ticketId")
    action = task.get("action")
    if not display_id or not ticket_id or not action:
        raise ApiError(f"POST /api/agent/status の応答にタスクの必須項目が無い: {task}")

    if len(tasks) > 1:
        log.info("処理待ちが %d 件ある。今回は %s だけを処理する", len(tasks), display_id)

    if dry_run:
        log.info("dry-run: %s を %s として処理するところ", display_id, action)
        return 0

    run = call_api(config, "POST", "/api/agent/runs", {"ticketId": ticket_id, "action": action})
    run_id = run.get("runId")
    if not run_id:
        raise ApiError(f"POST /api/agent/runs の応答に runId が無い: {run}")

    try:
        result, summary = run_claude(config, task)
    except Exception as e:  # noqa: BLE001 (実行の記録を必ず閉じるため、想定外の例外も拾う)
        log.exception("claude の起動処理で予期しない例外が発生した")
        result, summary = "failed", f"unexpected error: {e}"[:SUMMARY_LIMIT]

    # 実行の記録だけは必ず閉じる。開いたままだとこのチケットを二度と拾えなくなる
    try:
        call_api(config, "PATCH", f"/api/agent/runs/{run_id}", {"status": result, "summary": summary})
    except ApiError as e:
        log.error("実行の終了を記録できなかった: %s", e)
        return 1

    # エージェントが finish_agent_task を呼んでいれば、チケットの状態はその報告が優先される。
    # 呼ばずに終わった実行は、ここで成功と伝えてもサーバー側で失敗として閉じられる
    log.info("実行の終了を記録した: run=%s status=%s", run_id, result)

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
        log.warning("ログファイルを開けない: %s (%s)", log_path, e)


def acquire_lock(lock_path: Path):
    """多重起動を防ぐ。cron 側の flock が無くても重ならないようにする"""
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
    parser.add_argument("command", choices=["poll"], help="poll: 担当チケットを 1 件処理する")
    parser.add_argument("--config", type=Path, default=None, help=f"設定ファイル(既定 {DEFAULT_CONFIG_PATH})")
    parser.add_argument("--dry-run", action="store_true", help="Claude を起動せず、何を処理するかだけを出す")
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

    lock = acquire_lock(args.lock)
    if lock is None:
        log.info("前回の実行がまだ動いているので何もしない")
        return 0

    try:
        return poll(config, args.dry_run)
    except ApiError as e:
        log.error("%s", e)
        return 1
    finally:
        lock.close()


if __name__ == "__main__":
    sys.exit(main())
