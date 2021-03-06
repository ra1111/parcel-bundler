'use strict';

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

var _require = require('events');

const EventEmitter = _require.EventEmitter;

const os = require('os');
const Farm = require('worker-farm/lib/farm');
const promisify = require('./utils/promisify');

let shared = null;

class WorkerFarm extends Farm {
  constructor(options) {
    let opts = {
      autoStart: true,
      maxConcurrentWorkers: getNumWorkers()
    };

    super(opts, require.resolve('./worker'));

    this.localWorker = this.promisifyWorker(require('./worker'));
    this.remoteWorker = this.promisifyWorker(this.setup(['init', 'run']));

    this.started = false;
    this.init(options);
  }

  init(options) {
    this.localWorker.init(options);
    this.initRemoteWorkers(options);
  }

  promisifyWorker(worker) {
    let res = {};

    for (let key in worker) {
      res[key] = promisify(worker[key].bind(worker));
    }

    return res;
  }

  initRemoteWorkers(options) {
    var _this = this;

    return _asyncToGenerator(function* () {
      _this.started = false;

      let promises = [];
      for (let i = 0; i < _this.activeChildren; i++) {
        promises.push(_this.remoteWorker.init(options));
      }

      yield Promise.all(promises);
      _this.started = true;
    })();
  }

  receive(data) {
    if (data.event) {
      this.emit(data.event, ...data.args);
    } else {
      super.receive(data);
    }
  }

  run(...args) {
    var _this2 = this;

    return _asyncToGenerator(function* () {
      // Child process workers are slow to start (~600ms).
      // While we're waiting, just run on the main thread.
      // This significantly speeds up startup time.
      if (!_this2.started) {
        return _this2.localWorker.run(...args);
      } else {
        return _this2.remoteWorker.run(...args);
      }
    })();
  }

  end() {
    super.end();
    shared = null;
  }

  static getShared(options) {
    if (!shared) {
      shared = new WorkerFarm(options);
    } else {
      shared.init(options);
    }

    return shared;
  }
}

for (let key in EventEmitter.prototype) {
  WorkerFarm.prototype[key] = EventEmitter.prototype[key];
}

function getNumWorkers() {
  let cores;
  try {
    cores = require('physical-cpu-count');
  } catch (err) {
    cores = os.cpus().length;
  }
  return cores || 1;
}

module.exports = WorkerFarm;