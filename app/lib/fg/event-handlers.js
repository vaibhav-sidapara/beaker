import * as yo from 'yo-yo'

export function pushUrl (e) {
  // ignore ctrl/cmd+click
  if (e.metaKey)
    return

  var url = findParent(e.target, el => el.tagName === 'A').getAttribute('href')
  if (url) {
    e.preventDefault()
    e.stopPropagation()
    window.history.pushState(null, '', url)
  }
}

export function findParent (node, test) {
  while (node) {
    if (test(node)) {
      return node
    }
    node = node.parentNode
  }
}

export function writeToClipboard (str) {
  var textarea = yo`<textarea>${str}</textarea>`
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}