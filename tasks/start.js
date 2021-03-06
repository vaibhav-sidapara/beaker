'use strict'

var childProcess = require('child_process')
var electron = require('electron')
var gulp = require('gulp')

gulp.task('start', start)
gulp.task('start-watch', ['watch'], start)

function start () {
  if (process.env.ELECTRON_PATH) {
    electron = process.env.ELECTRON_PATH
  }
  console.log('Spawning electron', electron)
  childProcess.spawn(electron, ['./app'], {
    stdio: 'inherit'
  })
  .on('close', function () {
    // User closed the app. Kill the host process.
    process.exit()
  })
}
