import * as yo from 'yo-yo'
import co from 'co'

// globals
// =

var navItems = [
  { href: 'beaker:start', label: 'Favorites', icon: 'star' },
  { href: 'beaker:archives', label: 'Files', icon: 'folder' },
  { href: 'beaker:history', label: 'History', icon: 'back-in-time' },
  { href: 'beaker:downloads', label: 'Downloads', icon: 'down-circled' },
  { href: 'beaker:settings', label: 'Settings', icon: 'list' }
]

co(function *() {
  // fetch dynamic nav items
  // var moreNavItems = yield beakerBrowser.getHomePages()
  // moreNavItems = moreNavItems.filter(item => (typeof item.href == 'string') && (typeof item.label == 'string'))
  // navItems = navItems.concat(moreNavItems)
  // update()
})

// re-render when the URL changes
window.addEventListener('pushstate', update)
window.addEventListener('popstate', update)

// exported API
// =

export function setup () {
  document.getElementById('el-sidenav').appendChild(render())
}

export function update () {
  yo.update(document.querySelector('#el-sidenav nav'), render())
}

// rendering
// =

function render () {
  return yo`<nav class="nav-group">
    <img class="logo" src="beaker:logo">
    <a class="btn" onclick=${onClickShareFiles}>Share Files</a>
    ${navItems.map(renderNavItem)}
  </nav>`
}

function renderNavItem (item) {
  // render headers (represented by just a string)
  if (typeof item == 'string' || item.innerHTML)
    return yo`<h5 class="nav-group-title">${item}</h5>`

  // render items
  var { href, label, icon } = item
  var isActive = window.location == href
  return yo`<a class=${'nav-group-item' + (isActive?' active':'')} href=${href} onclick=${onClickNavItem(item)}>
    <span class="icon icon-${icon}"></span> ${label}
  </a>`
}

// event handlers
// =

function onClickNavItem (item) {
  return e => {
    // ignore ctrl/cmd+click
    if (e.metaKey)
      return
    e.preventDefault()

    if (window.location.protocol == 'beaker:' && item.href.startsWith('beaker:')) {
      // just navigate virtually, if we're on and going to a beaker: page
      window.history.pushState(null, '', item.href)
    } else {
      // actually go to the page
      window.location = item.href
    }
  }
}

function onClickShareFiles (e) {
  co(function* () {
    var paths = yield beakerBrowser.showOpenDialog({
      title: 'Choose a folder to import',
      buttonLabel: 'Import',
      properties: ['openFile', 'openDirectory', 'multiSelections', 'createDirectory', 'showHiddenFiles']
    })
    if (paths && paths.length) {
      var key = yield datInternalAPI.createNewArchive({ importFiles: paths })
      window.location = 'beaker:archive/' + key
    }
  })
}
