/**
 * 紹介サイトの OGP 画像(1200×630)を、docs/images のスクリーンショットから作り直す。
 *
 *   pnpm site:og-image
 *
 * 文字は SVG で描くため、日本語の表示にホストのフォント(Noto Sans CJK JP)を使う。
 */
import path from 'node:path'
import sharp from 'sharp'

const W = 1200
const H = 630
const SHOT = { width: 780, x: 470, y: 70, radius: 14 }
const TEXT_Y = 230
const LINE_HEIGHT = 48
const FONT = "'Noto Sans CJK JP', 'DejaVu Sans', sans-serif"

const VARIANTS = [
  {
    out: 'site/assets/og-image.png',
    shot: 'docs/images/board.webp',
    // サイドバーとフィルタを除いて、かんばんの列だけを見せる
    crop: { left: 290, top: 270, width: 1060, height: 675 },
    lines: ['AI エージェントと進める', 'セルフホスト型の', 'かんばん・チケット管理'],
    chips: ['MCP サーバー内蔵', 'Claude / Codex / OpenCode', 'GitHub / GitLab / Slack', 'Docker Compose / MIT'],
  },
  {
    out: 'site/assets/og-image-en.png',
    shot: 'docs/images/dashboard-en.webp',
    lines: ['Self-hosted kanban', '& tickets, worked', 'with AI agents'],
    chips: ['Built-in MCP server', 'Claude / Codex / OpenCode', 'GitHub / GitLab / Slack', 'Docker Compose / MIT'],
  },
]

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const build = async (variant) => {
  const image = sharp(variant.shot)
  const meta = await image.metadata()
  const crop = variant.crop ?? { left: 0, top: 0, width: meta.width, height: meta.height }
  const shotH = Math.round((crop.height / crop.width) * SHOT.width)
  if (SHOT.y + shotH > H) {
    throw new Error(`${variant.shot}: 切り出しが縦に長すぎる(高さ ${shotH})`)
  }

  const mask = `<svg width="${SHOT.width}" height="${shotH}"><rect width="${SHOT.width}" height="${shotH}" rx="${SHOT.radius}"/></svg>`
  const shot = await image
    .extract(crop)
    .resize(SHOT.width, shotH)
    .composite([{ input: Buffer.from(mask), blend: 'dest-in' }])
    .png()
    .toBuffer()

  const logo = await sharp('site/assets/logo.png').resize(300).png().toBuffer()
  const logoMeta = await sharp(logo).metadata()

  const lines = variant.lines
    .map(
      (line, i) =>
        `<text x="56" y="${TEXT_Y + i * LINE_HEIGHT}" font-family="${FONT}" font-size="36" font-weight="700" fill="#ffffff">${escapeXml(line)}</text>`,
    )
    .join('')
  const chipY = TEXT_Y + variant.lines.length * LINE_HEIGHT + 20
  const chips = variant.chips
    .map(
      (chip, i) =>
        `<g transform="translate(56 ${chipY + i * 46})"><rect width="380" height="36" rx="18" fill="#2a3f6e"/><circle cx="20" cy="18" r="5" fill="#f29a2e"/><text x="36" y="25" font-family="${FONT}" font-size="19" fill="#e6e9f0">${escapeXml(chip)}</text></g>`,
    )
    .join('')

  const background = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="#1c2d52"/>
    <rect x="40" y="56" width="${logoMeta.width + 32}" height="${logoMeta.height + 24}" rx="16" fill="#ffffff"/>
    <rect x="${SHOT.x + 10}" y="${SHOT.y + 14}" width="${SHOT.width}" height="${shotH}" rx="${SHOT.radius}" fill="#000000" opacity="0.35"/>
    ${lines}${chips}
  </svg>`

  await sharp(Buffer.from(background))
    .composite([
      { input: logo, left: 56, top: 68 },
      // 右端は画像の外にはみ出させて切る
      { input: shot, left: SHOT.x, top: SHOT.y },
    ])
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(variant.out)
  console.log(path.normalize(variant.out))
}

await Promise.all(VARIANTS.map(build))
