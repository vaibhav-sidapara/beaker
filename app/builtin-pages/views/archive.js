/*
This uses the beakerBrowser API, which is exposed by webview-preload to all sites loaded over the beaker: protocol
*/

import * as yo from 'yo-yo'
import co from 'co'
import emitStream from 'emit-stream'
import Remarkable from 'remarkable'
import { pushUrl } from '../../lib/fg/event-handlers'
import dragDrop from '../../lib/fg/drag-drop'
import { throttle } from '../../lib/functions'
import { archiveEntries, entriesListToTree, calculateTreeSizeAndProgress } from '../com/files-list'
import toggleable from '../com/toggleable'
import HypercoreStats from '../com/hypercore-stats'
import * as editArchiveModal from '../com/modals/edit-site'
import * as forkDatModal from '../com/modals/fork-dat'
import * as helpTour from '../com/help-tour'

// globals
// =

var md = new Remarkable({
  html:         false,        // Enable HTML tags in source
  xhtmlOut:     false,        // Use '/' to close single tags (<br />)
  breaks:       false,        // Convert '\n' in paragraphs into <br>
  langPrefix:   'language-',  // CSS language prefix for fenced blocks
  linkify:      true,         // Autoconvert URL-like text to links

  // Enable some language-neutral replacement + quotes beautification
  typographer:  false,

  // Double + single quotes replacement pairs, when typographer enabled,
  // and smartquotes on. Set doubles to '«»' for Russian, '„“' for German.
  quotes: '“”‘’',

  // Highlighter function. Should return escaped HTML,
  // or '' if the source string is not changed
  highlight: (str, lang) => { return ''; }
})

var isViewActive = false
var archiveKey
var archiveInfo
var archiveEntriesTree
var archiveCurrentNode = null
var archiveError = false
var hideDotfiles = true
var hypercoreStats
var currentForkModal = null // currently visible fork modal: we need a reference to trigger rendering on download

// event emitter
var archivesEvents

// exported API
// =

export function setup () {
  // wire up events
  archivesEvents = emitStream(datInternalAPI.archivesEventStream())
  archivesEvents.on('update-archive', onUpdateArchive)
  archivesEvents.on('update-listing', onUpdateListing)
  archivesEvents.on('download', onDownload)
}

export function show (isSameView) {
  // navigation within the active view?
  if (isSameView && archiveKey === parseKeyFromURL()) {
    // just adjust current view
    setCurrentNodeByPath()
    setWindowSublocation()
    render()
    return
  }

  // start loading
  isViewActive = true
  archiveKey = parseKeyFromURL()

  // if archiveKey is invalid, figure out why
  if (!archiveKey) {
    // was the dat:// included?
    if (window.location.pathname.startsWith('archive/dat://')) {
      // redirect to remove that
      window.location = 'beaker:archive/' + window.location.pathname.slice('archive/dat://'.length)
      return
    }

    // try a dns lookup
    let name = /^archive\/([^/]+)/.exec(window.location.pathname)[1]
    datInternalAPI.resolveName(name, (err, key) => {
      if (err) {
        archiveError = new Error('Invalid Dat URL')
        render()
      } else {
        // redirect
        window.location = 'beaker:archive/' + key
      }
    })
    return
  }

  co(function * () {
    try {
      setWindowSublocation()
      document.title = 'Loading...'
      render() // render loading state
      yield fetchArchiveInfo()
    } catch (e) {}

    // now that it has loaded, redirect to dat:// if this was a timeout view
    if (window.location.hash === '#timeout') {
      var destURL = 'dat://' + /^archive\/(.*)/.exec(window.location.pathname)[1]
      console.log('Archive found! Redirecting to', destURL)
      window.location = destURL
      return
    }

    // render
    hypercoreStats = new HypercoreStats(archivesEvents, { archiveInfo })
    render()
    if (archiveInfo.isOwner) {
      dragDrop('.window', onDragDrop)
    }

    // run the tour if this is the owner's first time
    const tourSeenSetting = (archiveInfo.isOwner) ? 'has-seen-viewdat-owner-tour' : 'has-seen-viewdat-reader-tour'
    var hasSeenTour = false
    try { hasSeenTour = yield datInternalAPI.getGlobalSetting(tourSeenSetting) }
    catch (e) {}
    if (!hasSeenTour) {
      helpTour.startViewDatTour(archiveInfo.isOwner, render, true)
      yield datInternalAPI.setGlobalSetting(tourSeenSetting, true)
    }
  })
}

export function hide (isSameView) {
  if (isSameView && archiveKey === parseKeyFromURL()) {
    // do nothing, it's a navigation within the current archive's folder structure
    return
  }
  isViewActive = false
  window.locationbar.clearSublocation()
  archiveKey = null
  archiveInfo = null
  archiveEntriesTree = null
  archiveCurrentNode = null
  archiveError = false
  if (hypercoreStats) {
    hypercoreStats.destroy()
  }
  hypercoreStats = null
}

// rendering
// =

function render () {
  if (!isViewActive) {
    return
  }

  if (archiveInfo) {
    renderArchive()
  } else if (archiveError) {
    renderError()
  } else {
    renderLoading()
  }

  if (currentForkModal) {
    currentForkModal.rerender()
  }
}

function renderArchive () {
  const name = archiveInfo.title || 'Untitled'

  // set page title
  document.title = name

  // description
  var descriptEl = (archiveInfo.description)
    ? yo`<span>${archiveInfo.description}</span>`
    : yo`<em>no description</em>`

  // manifest edit btn (a pain to construct so it's separate)
  var editBtn
  if (archiveInfo.isOwner) {
    editBtn = yo`<span><span></span> <a id="edit-dat-btn" onclick=${onEditArchive}>Edit</a></span>`
    editBtn.childNodes[0].innerHTML = '&mdash;'
  }

  // downloader's btns
  var syncBtn
  if (archiveInfo.isOwner) {
    syncBtn = (archiveInfo.userSettings.isServing)
      ? yo`<a id="sync-btn" class="btn btn-primary glowing" title="Sharing" onclick=${onToggleServing}><span class="icon icon-share"></span> Sharing</span>`
      : yo`<a id="sync-btn" class="btn" title="Share" onclick=${onToggleServing}><span class="icon icon-share"></span> Share</a>`
  } else {
    let entry = archiveEntriesTree.entry
    let isDownloaded = entry.downloadedBlocks >= entry.blocks
    let label = (isDownloaded) ? 'Sync' : 'Download'
    syncBtn = (archiveInfo.userSettings.isServing)
      ? yo`<a id="sync-btn" class="btn btn-primary glowing" title="${label}ing" onclick=${onToggleServing}><span class="icon icon-down-circled"></span> ${label}ing</a>`
      : yo`<a id="sync-btn" class="btn" title=${label} onclick=${onToggleServing}><span class="icon icon-down-circled"></span> ${label}</a>`
  }

  // readme
  var readmeEl
  if (archiveInfo.readme) {
    readmeEl = yo`<div class="markdown"></div>`
    readmeEl.innerHTML = md.render(archiveInfo.readme)
  }

  // progress bar for the entire dat
  var progressEl
  if (!archiveInfo.isOwner) {
    let entry = archiveEntriesTree.entry
    let progress = Math.round(entry.downloadedBlocks / entry.blocks * 100)
    progressEl = yo`<div class="archive-progress"><progress value=${progress} max="100"></progress></div>`
  }

  // render view
  yo.update(document.querySelector('#el-content'), yo`<div class="pane" id="el-content">
    <div class="archive">
      ${renderHeading()}
      <div class="archive-summary">
        <div>${descriptEl} ${editBtn}</div>
        <div class="flex-spacer"></div>
        ${hypercoreStats.render()}
        ${syncBtn}
      </div>
      ${progressEl}
      ${archiveEntries(archiveCurrentNode, {
        onOpenFolder,
        onToggleHidden,
        archiveKey,
        hideDotfiles
      })}
      ${readmeEl}
      <input class="hidden-file-adder" type="file" multiple onchange=${onChooseFiles} />
    </div>
  </div>`)
}

function renderHeading () {
  const name = archiveInfo.title || 'Untitled'
  const isSaved = archiveInfo.userSettings.isSaved

  // general buttons
  var copyLinkBtn = yo`<button id="copy-link-btn" class="btn" title="Copy Link" onclick=${onCopyLink}><span class="icon icon-link"></span> Copy Link</button>`
  var openFolderBtn = yo`<a id="open-in-finder-btn" onclick=${onOpenInFinder}><span class="icon icon-popup"></span> Open in Finder</a>`
  var forkBtn = yo`<a id="fork-btn" title="Fork Archive" onclick=${onClickFork}><span class="icon icon-flow-branch"></span> Fork Archive</a>`
  var deleteArchiveBtn = yo`<a id="delete-btn" title="Delete Archive" onclick=${onToggleSave}><span class="icon icon-trash"></span> Delete Archive</a>`
  var dropdownBtn = toggleable(yo`<div class="dropdown-btn-container">
    <a class="toggleable btn"><span class="icon icon-down-open"></span></a>
    <div class="dropdown-btn-list">
      ${openFolderBtn}
      ${forkBtn}
      <hr />
      ${deleteArchiveBtn}
    </div>
  </div>`)

  if (archiveInfo.isOwner) {
    if (isSaved) {
      // owner's btns
      let addFilesBtn = yo`<a id="add-files-btn" class="btn btn-group" title="Add Files" onclick=${onClickSelectFiles}><span class="icon icon-plus"></span> Add Files</a>`

      // owner's heading
      return yo`<div class="ll-heading">
        <a href="beaker:archives" onclick=${pushUrl}>Files <span class="icon icon-right-open"></span></a>
        ${name}
        <small id="owner-label"><span class="icon icon-pencil" onclick=${onEditArchive}></span></small>
        <span class="btn-group">${copyLinkBtn}</span>
        ${dropdownBtn}
        ${addFilesBtn}
        <small class="ll-heading-right">
          <a onclick=${e => helpTour.startViewDatTour(archiveInfo.isOwner, render)}><span class="icon icon-address"></span> Tour</a>
          <a href="https://beakerbrowser.com/docs/" title="Get Help"><span class="icon icon-lifebuoy"></span> Help</a>
        </small>
      </div>`
    }

    // deleted owner's btns
    let undoDeleteBtn = yo`<small class="ll-heading-group">
      <span class="icon icon-trash"></span> Deleted
      (<a title="Undo Delete" onclick=${onToggleSave}>Undo</a>)
    </small>`

    // deleted owner's heading
    return yo`<div class="ll-heading">
      <a href="beaker:archives" onclick=${pushUrl}>Files <span class="icon icon-right-open"></span></a>
      ${name}
      <small id="owner-label"><span class="icon icon-pencil" onclick=${onEditArchive}></span></small>
      ${undoDeleteBtn}
      <small class="ll-heading-right">
        <a onclick=${e => helpTour.startViewDatTour(archiveInfo.isOwner, render)}><span class="icon icon-address"></span> Tour</a>
        <a href="https://beakerbrowser.com/docs/" title="Get Help"><span class="icon icon-lifebuoy"></span> Help</a>
      </small>
    </div>`
  }

  // downloader's heading
  return yo`<div class="ll-heading">
    ${ (isSaved)
      ? yo`<a href="beaker:downloads" onclick=${pushUrl}>Downloads <span class="icon icon-right-open"></span></a>`
      : '' }
    ${name}
    <small id="owner-label">read-only</small>
    <span class="btn-group">${copyLinkBtn}</span>
    ${dropdownBtn}
    <small class="ll-heading-right">
      <a onclick=${e => helpTour.startViewDatTour(archiveInfo.isOwner, render)}><span class="icon icon-address"></span> Tour</a>
      <a href="https://beakerbrowser.com/docs/" title="Get Help"><span class="icon icon-lifebuoy"></span> Help</a>
    </small>
  </div>`
}

function renderError () {
  // render view
  yo.update(document.querySelector('#el-content'), yo`<div class="pane" id="el-content">
    <div class="archive">
      <div class="ll-heading">
        ${archiveKey.slice(0,8)}...
        <small class="ll-heading-right">
          <a href="https://beakerbrowser.com/docs/" title="Get Help"><span class="icon icon-lifebuoy"></span> Help</a>
        </small>
      </div>
      <div class="archive-error">
        <div class="archive-error-banner">
          <div class="icon icon-attention"></div>
          <div>The archive failed to load. ${archiveError.toString()}. Sorry for the inconvenience.</div>
        </div>
      </div>
    </div>
  </div>`)
}

function renderLoading () {
  // render view
  yo.update(document.querySelector('#el-content'), yo`<div class="pane" id="el-content">
    <div class="archive">
      <div class="ll-heading">
        Loading...
        <small class="ll-heading-right">
          <a href="https://beakerbrowser.com/docs/" title="Get Help"><span class="icon icon-lifebuoy"></span> Help</a>
        </small>
      </div>
      <div class="archive-loading">
        <div class="archive-loading-banner">
          <div class="spinner"></div>
          <div>Searching the network for this archive. Please wait...</div>
        </div>
        <div class="archive-loading-tips">
          <p><strong>Try:</strong></p>
          <ul>
            <li>Checking your connection</li>
            <li>Checking your firewall settings</li>
          </ul>
          <p>
            If you are the author of this archive, make sure it's being hosted on the network.
            <a href="https://beakerbrowser.com/docs/guides/cloud-hosting.html" target="_blank">More Help</a>
          </p>
        </div>
      </div>
    </div>
  </div>`)
}

// internal methods
// =

function parseKeyFromURL () {
  try {
    return /^archive\/([0-9a-f]{64})/.exec(window.location.pathname)[1]
  } catch (e) {
    return ''
  }
}

// helper to get the archive info
// throttled to 1 call per second so that update events can freely trigger it
const fetchArchiveInfo = throttle(cb => {
  return co(function * () {
    // run request
    archiveInfo = yield datInternalAPI.getArchiveInfo(archiveKey, { loadIfMissing: true })
    if (archiveInfo) {
      archiveEntriesTree = entriesListToTree(archiveInfo)
      calculateTreeSizeAndProgress(archiveInfo, archiveEntriesTree)
    }
    console.log(archiveInfo)
    console.log(archiveEntriesTree)
    setCurrentNodeByPath()

    cb && cb()
  }).catch(err => {
    console.warn('Failed to fetch archive info', err)
    archiveError = err
  })
}, 1e3)

// set the sublocation in the window
function setWindowSublocation () {
  var subpath = window.location.pathname.split('/').slice(2).join('/') // drop 'archive/{name}', take the rest
  window.locationbar.setSublocation({
    title: 'Dat Viewer',
    value: 'dat://' + archiveKey + '/' + subpath
  })
}

// use the current url's path to set the `archiveCurrentNode`
function setCurrentNodeByPath () {
  archiveCurrentNode = archiveEntriesTree
  var names = window.location.pathname.split('/').slice(2) // drop 'archive/{name}', take the rest
  if (names.length === 0 || names[0] == '')
    return // at root

  // descend to the correct node (or as far as possible)
  for (var i=0; i < names.length; i++) {
    var child = archiveCurrentNode.children[names[i]]
    if (!child || child.entry.type != 'directory')
      return // child dir not found, stop here
    archiveCurrentNode = child
  }
}

function downloadArchiveNode (node) {
  // recursively start downloads
  co(function *() {
    yield startDownload(node)
    render()
  })

  function * startDownload (n) {
    // do nothing if already downloaded
    if (n.entry.downloadedBlocks === n.entry.blocks) {
      return Promise.resolve()
    }

    // render progress starting
    n.entry.isDownloading = true
    render()

    if (n.entry.type === 'file') {
      // download entry
      yield datInternalAPI.downloadArchiveEntry(archiveInfo.key, n.entry.path)
    } else if (n.entry.type === 'directory') {
      // recurse to children
      yield Object.keys(n.children).map(k => startDownload(n.children[k]))
    }

    // render done
    n.entry.isDownloading = false
    render()

    return Promise.resolve()
  }
}

// event handlers: archive editor
// =

function onEditArchive (isNew) {
  isNew = isNew === true
  editArchiveModal.create(
    isNew ? {} : archiveInfo,
    { isNew, title: 'Edit Details', onSubmit: onSubmitEditArchive }
  )
}

function onSubmitEditArchive ({ title, description }) {
  // send write to the backend
  datInternalAPI.updateArchiveManifest(archiveInfo.key, { title, description })
    .catch(console.warn.bind(console, 'Failed to update manifest'))
}

// event handlers: files uploader
// =

function onClickSelectFiles (e) {
  e.preventDefault()
  co(function * () {
    var paths = yield beakerBrowser.showOpenDialog({
      title: 'Choose a folder to import',
      buttonLabel: 'Import',
      properties: ['openFile', 'openDirectory', 'multiSelections', 'createDirectory', 'showHiddenFiles']
    })
    if (paths) {
      addFiles(paths)
    }
  })
}

function onChooseFiles (e) {
  var filesInput = document.querySelector('input[type="file"]')
  var files = Array.from(filesInput.files)
  filesInput.value = '' // clear the input
  addFiles(files)
}

function onDragDrop (files) {
  addFiles(files)
}

function addFiles (files) {
  files.forEach(file => {
    // file-picker gies a string, while drag/drop gives { path: string }
    var src = (typeof file === 'string') ? file : file.path
    var dst = archiveCurrentNode.entry.path

    // send to backend
    datInternalAPI.writeArchiveFileFromPath(archiveInfo.key, { src, dst })
      .catch(console.warn.bind(console, 'Error writing file:'))
  })
}

// event handlers: toolbar
// =

function onToggleSave () {
  archiveInfo.userSettings.isSaved = !archiveInfo.userSettings.isSaved

  // isServing must reflect isSaved
  if (!archiveInfo.userSettings.isSaved && archiveInfo.userSettings.isServing)
    archiveInfo.userSettings.isServing = false

  datInternalAPI.setArchiveUserSettings(archiveInfo.key, archiveInfo.userSettings)
  render()
}

function onToggleServing () {
  archiveInfo.userSettings.isServing = !archiveInfo.userSettings.isServing

  // isSaved must reflect isServing
  if (archiveInfo.userSettings.isServing && !archiveInfo.userSettings.isSaved)
    archiveInfo.userSettings.isSaved = true

  datInternalAPI.setArchiveUserSettings(archiveInfo.key, archiveInfo.userSettings)
  render()
}

function onCopyLink () {
  var textarea = yo`<textarea>${'dat://'+archiveInfo.key}</textarea>`
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

function onOpenFolder (e, entry) {
  e.preventDefault()
  window.history.pushState(null, '', 'beaker:archive/' + archiveInfo.key + '/' + entry.path)
}

function onOpenInFinder () {
  datInternalAPI.openInExplorer(archiveInfo.key)
  render()
}

function onClickFork (e) {
  // create fork modal
  currentForkModal = forkDatModal.create(archiveInfo, archiveEntriesTree, {
    isDownloading: archiveInfo.userSettings.isServing,
    onClickDownload: onDownloadForkArchive,
    onSubmit: onSubmitForkArchive
  })
  currentForkModal.addEventListener('close', () => currentForkModal = null, { once: true })
}

function onDownloadForkArchive () {
  if (currentForkModal) {
    // download the entire tree
    downloadArchiveNode(archiveEntriesTree)
    currentForkModal.rerender()
  }
}

function onSubmitForkArchive ({ title, description }) {
  // what do you do when you see a fork in the code?
  datInternalAPI.forkArchive(archiveInfo.key, { title, description }).then(newKey => {
    // you take it
    window.location = 'beaker:archive/' + newKey
  }).catch(err => {
    console.error(err) // TODO alert user
  })
}

// event handlers: files listing
// =

function onToggleHidden () {
  hideDotfiles = !hideDotfiles
  render()
}

// event handlers: archive events
// =

function onUpdateArchive (update) {
  if (archiveInfo && update.key === archiveInfo.key) {
    // patch the archive
    for (var k in update)
      archiveInfo[k] = update[k]
    render()
  }
}

function onUpdateListing (update) {
  if (archiveInfo && update.key === archiveInfo.key) {
    // simplest solution is just to refetch the entries
    fetchArchiveInfo(render)
  }
}

function onDownload (update) {
  if (archiveInfo && update.key === archiveInfo.key && update.feed === 'content') {
    // increment root's downloaded blocks
    archiveEntriesTree.entry.downloadedBlocks++

    // find the file and folders this update belongs to and increment their downloaded blocks
    for (var i=0; i < archiveInfo.entries.length; i++) {
      var entry = archiveInfo.entries[i]
      var index = update.index - entry.content.blockOffset
      if (index >= 0 && index < entry.blocks)
        entry.downloadedBlocks++ // update the entry
    }

    // render update
    render()
  }
}

