export default {
  getArchiveInfo: 'promise',
  getArchiveStats: 'promise',
  getSavedArchives: 'promise',

  resolveName: 'async',

  createNewArchive: 'promise',
  forkArchive: 'promise',
  setArchiveUserSettings: 'promise',
  updateArchiveManifest: 'promise',
  writeArchiveFileFromPath: 'promise',

  swarm: 'sync',
  unswarm: 'sync',
  downloadArchiveEntry: 'promise',
  openInExplorer: 'sync',
  archivesEventStream: 'readable',

  getGlobalSetting: 'promise',
  setGlobalSetting: 'promise'
}
