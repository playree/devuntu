/**
 * 紹介サイトの OGP 画像(1200×630)を、docs/images のスクリーンショットから作り直す。
 *
 *   pnpm site:og-image
 *
 * 文字は SVG で描くため、日本語の表示にホストのフォント(Noto Sans CJK JP)を使う。
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import sharp from 'sharp'

const W = 1200
const H = 630
const SHOT = { width: 780, x: 470, y: 70, radius: 14, shadow: 14 }
const BOTTOM_MARGIN = 16
const LOGO = { width: 300, x: 56, y: 60, padX: 16, padY: 12 }
const LINE_HEIGHT = 48
const CHIP_PITCH = 44
const JA_FONT = 'Noto Sans CJK JP'
const FONT = `'${JA_FONT}', 'DejaVu Sans', sans-serif`

const VARIANTS = [
  {
    out: 'site/assets/og-image.png',
    shot: 'docs/images/board.webp',
    // サイドバーとフィルタを除いて、かんばんの列だけを見せる(元画像に対する比率)
    crop: { left: 0.215, top: 0.286, width: 0.785, height: 0.714 },
    lines: ['AI エージェントと進める', 'セルフホスト型の', 'かんばん・チケット管理'],
    chips: ['MCP サーバー内蔵', 'Claude / Codex / OpenCode', 'GitHub / GitLab / Slack', 'Docker Compose / MIT'],
  },
  {
    out: 'site/assets/og-image-en.png',
    shot: 'docs/images/dashboard-en.webp',
    // 右の列(お知らせ・リリースノート)は日本語の文面なので含めない
    crop: { left: 0, top: 0, width: 0.62, height: 0.6 },
    lines: ['Self-hosted kanban', '& tickets, worked', 'with AI agents'],
    chips: ['Built-in MCP server', 'Claude / Codex / OpenCode', 'GitHub / GitLab / Slack', 'Docker Compose / MIT'],
  },
]

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const assertFont = () => {
  const families = execFileSync('fc-list', [':lang=ja', 'family'], { encoding: 'utf8' })
  if (!families.includes(JA_FONT)) {
    throw new Error(`フォント ${JA_FONT} が無い(日本語が豆腐になる)`)
  }
}

const build = async (variant) => {
  const image = sharp(variant.shot)
  const meta = await image.metadata()
  const crop = {
    left: Math.round(variant.crop.left * meta.width),
    top: Math.round(variant.crop.top * meta.height),
    width: Math.round(variant.crop.width * meta.width),
    height: Math.round(variant.crop.height * meta.height),
  }
  const shotH = Math.round((crop.height / crop.width) * SHOT.width)
  if (SHOT.y + shotH + SHOT.shadow > H - BOTTOM_MARGIN) {
    throw new Error(`${variant.shot}: 切り出しが縦に長すぎる(高さ ${shotH})`)
  }

  const mask = `<svg width="${SHOT.width}" height="${shotH}"><rect width="${SHOT.width}" height="${shotH}" rx="${SHOT.radius}"/></svg>`
  const shot = await image
    .extract(crop)
    .resize(SHOT.width, shotH)
    .composite([{ input: Buffer.from(mask), blend: 'dest-in' }])
    .png()
    .toBuffer()

  const logo = await sharp('site/assets/logo.png').resize(LOGO.width).png().toBuffer()
  const logoMeta = await sharp(logo).metadata()
  const logoBox = {
    x: LOGO.x - LOGO.padX,
    y: LOGO.y - LOGO.padY,
    width: logoMeta.width + LOGO.padX * 2,
    height: logoMeta.height + LOGO.padY * 2,
  }

  // 見出しの1行目のベースラインは、ロゴの白枠の下から文字の高さ分以上あける
  const textY = logoBox.y + logoBox.height + 52
  const lines = variant.lines
    .map(
      (line, i) =>
        `<text x="56" y="${textY + i * LINE_HEIGHT}" font-family="${FONT}" font-size="36" font-weight="700" fill="#ffffff">${escapeXml(line)}</text>`,
    )
    .join('')
  const chipY = textY + (variant.lines.length - 1) * LINE_HEIGHT + 32
  const chips = variant.chips
    .map(
      (chip, i) =>
        `<g transform="translate(56 ${chipY + i * CHIP_PITCH})"><rect width="380" height="36" rx="18" fill="#2a3f6e"/><circle cx="20" cy="18" r="5" fill="#f29a2e"/><text x="36" y="25" font-family="${FONT}" font-size="19" fill="#e6e9f0">${escapeXml(chip)}</text></g>`,
    )
    .join('')
  if (chipY + (variant.chips.length - 1) * CHIP_PITCH + 36 > H - BOTTOM_MARGIN) {
    throw new Error(`${variant.out}: 見出しと項目が下にはみ出す`)
  }

  const background = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="#1c2d52"/>
    <rect x="${logoBox.x}" y="${logoBox.y}" width="${logoBox.width}" height="${logoBox.height}" rx="16" fill="#ffffff"/>
    <rect x="${SHOT.x + 10}" y="${SHOT.y + SHOT.shadow}" width="${SHOT.width}" height="${shotH}" rx="${SHOT.radius}" fill="#000000" opacity="0.35"/>
    ${lines}${chips}
  </svg>`

  await sharp(Buffer.from(background))
    .composite([
      { input: logo, left: LOGO.x, top: LOGO.y },
      // 右端は画像の外にはみ出させて切る
      { input: shot, left: SHOT.x, top: SHOT.y },
    ])
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(variant.out)
  console.log(path.normalize(variant.out))
}

assertFont()
await Promise.all(VARIANTS.map(build))
