var Buffer = require('buffer').Buffer;
var child_process = require('child_process');
var fs = require('fs');
var gutil = require('gulp-util');
var path = require('path');
var tempWrite = require('temp-write-old');
var through = require('through');

const PLUGIN_NAME = 'gulp-closure-library';
gutil.PluginError = gutil.PluginError || function PluginError(name, msg) {
  return new Error('[' + name + ':error] - ' + msg);
}

module.exports = function(opt, execFile_opt) {
  opt = opt || {};
  var files = [];
  var execFile = execFile_opt || child_process.execFile;

  if (!opt.compilerPath)
    throw new gutil.PluginError(PLUGIN_NAME, 'Missing compilerPath option.');
  if (!opt.fileName)
    throw new gutil.PluginError(PLUGIN_NAME, 'Missing fileName option.');

  var getFlagFilePath = function(files) {
    var src = files.map(function(file) {
      var relativePath = path.relative(file.cwd, file.path);
      var tempPath = tempWrite.sync(file.contents.toString(), relativePath);
      return '--js=' + tempPath;
    }).join('\n');
    return tempWrite.sync(src);
  };

  // Can't use sindresorhus/dargs, compiler requires own syntax.
  var flagsToArgs = function(flags) {
    var args = [];
    for (var flag in flags || {}) {
      var values = flags[flag];
      if (!Array.isArray(values)) values = [values];
      values.forEach(function(value) {
        args.push('--' + flag + '=' + value);
      });
    }
    return args;
  };

  function bufferContents(file) {
    if (file.contents == null) return;
    if (gutil.isStream(file.contents)) {
      return this.emit('error',
        new gutil.PluginError(PLUGIN_NAME, 'Streaming not supported'));
    }
    files.push(file);
  }

  function endStream() {
    if (!files.length) return this.emit('end');
    var firstFile = files[0];
    var outputFilePath = tempWrite.sync('');
    var args = [
      '-jar',
      // For faster compilation. It's supported everywhere from Java 1.7+.
      '-XX:+TieredCompilation',
      opt.compilerPath,
      // To prevent maximum length of command line string exceeded error.
      '--flagfile=' + getFlagFilePath(files)
    ].concat(flagsToArgs(opt.compilerFlags));

    // Force --js_output_file to prevent [Error: stdout maxBuffer exceeded.]
    args.push('--js_output_file=' + outputFilePath);

    var jar = execFile('java', args, function(error, stdout, stderr) {
      if (error || stderr) {
        this.emit('error', new gutil.PluginError(PLUGIN_NAME, error || stderr));
        return;
      }

      var outputFileSrc = fs.readFile(outputFilePath, function(err, data) {
        if (err) {
          this.emit('error', new gutil.PluginError(PLUGIN_NAME, err));
          return;
        }

        var outputFile = new gutil.File({
          base: firstFile.base,
          contents: new Buffer(data),
          cwd: firstFile.cwd,
          path: path.join(firstFile.base, opt.fileName)
        });

        this.emit('data', outputFile);
        this.emit('end');
      }.bind(this));

    }.bind(this));
  }

  return through(bufferContents, endStream);
};
