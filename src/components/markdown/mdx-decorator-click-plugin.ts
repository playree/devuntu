import { createRootEditorSubscription$, realmPlugin } from '@mdxeditor/editor'
import { CLICK_COMMAND, stopLexicalPropagation } from 'lexical'

/**
 * 装飾ノード(画像など)のクリックを Lexical に届ける。
 *
 * Lexical は装飾ノードを `<span data-lexical-decorator>` への portal で描画するため、
 * その span が React のイベントデリゲーションのルートコンテナになる。React の合成イベントは
 * DOM ではなく React ツリーを遡るので、span で拾われた click は HeroUI の Modal.Backdrop まで
 * 到達し、そこが無条件に呼ぶ stopPropagation でネイティブの伝播ごと止められてしまう。
 * 結果、モーダル内では click がルート要素(contentEditable)へ上がらず Lexical の
 * `CLICK_COMMAND` が発火せず、画像を選択できない(選択枠もリサイズハンドルも出ない)。
 *
 * span より手前の capture フェーズで先回りしてコマンドを流し、モーダルの内外で挙動を揃える。
 */
export const decoratorClickPlugin = realmPlugin({
  init: (realm) => {
    realm.pub(createRootEditorSubscription$, (editor) => {
      const onClick = (event: MouseEvent) => {
        if (!(event.target instanceof Element) || !event.target.closest('[data-lexical-decorator]')) {
          return
        }
        editor.dispatchCommand(CLICK_COMMAND, event)
        // Lexical 自身がルート要素に張るリスナ(バブル)との二重発火を防ぐ
        stopLexicalPropagation(event)
      }
      return editor.registerRootListener((rootElement, prevRootElement) => {
        prevRootElement?.removeEventListener('click', onClick, true)
        rootElement?.addEventListener('click', onClick, true)
      })
    })
  },
})
