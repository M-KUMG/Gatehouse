'use strict';
// The setup window's page. It talks to the app through `window.gatehouseSetup` (electron/installer-preload.cjs):
//   info()            -> { mode: 'install' | 'uninstall', version, dir, existing: { version, dir } | null }
//   chooseDir()       -> { dir } | { cancelled: true }
//   run(options)      -> { ok: true } | { error }   options: { dir, startMenu, desktop, deleteData }
//   onProgress(cb)    cb({ percent, file }) while run() works
//   launch(), minimize(), close()
// Opened in a plain browser (no host), a pretend host stands in so the design can be looked at:
//   index.html                     install        index.html?mode=uninstall   remove
//   index.html?existing=0.1.0      update         index.html?fail=1           the run ends in an error

(function () {
  var query = new URLSearchParams(location.search);
  var host = window.gatehouseSetup || pretendHost();
  if (window.gatehouseSetup) document.documentElement.classList.add('native'); // the real window is transparent

  function pretendHost() {
    var timer = null;
    return {
      info: function () {
        var existing = query.get('existing');
        var dir = 'C:\\Users\\you\\AppData\\Local\\Programs\\Gatehouse';
        return Promise.resolve({
          mode: query.get('mode') === 'uninstall' ? 'uninstall' : 'install',
          version: '0.2.0',
          dir: dir,
          existing: existing ? { version: existing, dir: dir } : null,
        });
      },
      chooseDir: function () {
        return Promise.resolve({ dir: 'D:\\Apps\\Gatehouse' });
      },
      onProgress: function (cb) {
        host.progress = cb;
      },
      run: function () {
        return new Promise(function (resolve) {
          var n = 0;
          var files = ['Gatehouse.exe', 'resources\\app.asar', 'resources\\toolchain-packs\\compiler.pack', 'locales\\en-US.pak', 'icudtl.dat'];
          clearInterval(timer);
          timer = setInterval(function () {
            n += 4;
            if (host.progress) host.progress({ percent: Math.min(n, 100), file: files[Math.floor(n / 21) % files.length] });
            if (n >= 100) {
              clearInterval(timer);
              resolve(query.get('fail') ? { error: 'Gatehouse is open. Close it and try again.' } : { ok: true });
            }
          }, 90);
        });
      },
      launch: function () {},
      minimize: function () {},
      close: function () {},
    };
  }

  var $ = function (id) {
    return document.getElementById(id);
  };
  var steps = Array.prototype.slice.call(document.querySelectorAll('.step'));
  var dots = Array.prototype.slice.call($('dots').children);
  var DOT = { welcome: 0, options: 0, remove: 0, working: 1, done: 2, error: 1 };

  var state = { mode: 'install', version: '', dir: '', existing: null };

  function show(name) {
    steps.forEach(function (s) {
      s.hidden = s.dataset.step !== name;
    });
    dots.forEach(function (d, i) {
      d.classList.toggle('on', i === DOT[name]);
    });
    var first = document.querySelector('.step[data-step="' + name + '"] .button.primary, .step[data-step="' + name + '"] .button.danger');
    if (first) first.focus({ preventScroll: true });
  }

  function setProgress(percent, file) {
    var p = Math.max(0, Math.min(100, Math.round(percent)));
    $('bar-fill').style.width = p + '%';
    $('bar').setAttribute('aria-valuenow', String(p));
    $('percent').textContent = p + '%';
    $('file').textContent = file || '';
  }

  function words() {
    var update = !!state.existing;
    return state.mode === 'uninstall'
      ? { workTitle: 'Removing', workText: 'Deleting files. This takes a moment.', doneTitle: 'Gatehouse is removed', doneText: 'The last few files go away a few seconds after you close this window. You can install it again any time.', hasLaunch: false }
      : {
          workTitle: update ? 'Updating' : 'Installing',
          workText: update ? 'Replacing the old files. Your circuits and settings stay.' : 'Copying files. This takes a moment.',
          doneTitle: update ? 'Gatehouse is up to date' : 'Gatehouse is installed',
          doneText: update ? 'Version ' + state.version + ' is ready.' : 'Find it in the Start menu, or open it now.',
          hasLaunch: true,
        };
  }

  function options() {
    return {
      dir: state.dir,
      startMenu: $('opt-start').checked,
      desktop: $('opt-desktop').checked,
      deleteData: $('opt-data').checked,
    };
  }

  function run() {
    var w = words();
    $('working-title').textContent = w.workTitle;
    $('working-text').textContent = w.workText;
    setProgress(0, '');
    show('working');
    host.onProgress(function (e) {
      setProgress(e.percent, e.file);
    });
    host
      .run(options())
      .then(function (result) {
        if (result && result.error) throw new Error(result.error);
        setProgress(100, '');
        $('done-title').textContent = w.doneTitle;
        $('done-text').textContent = w.doneText;
        $('launch').hidden = !w.hasLaunch;
        show('done');
      })
      .catch(function (err) {
        $('error-text').textContent = (err && err.message) || 'Something went wrong.';
        show('error');
      });
  }

  function setup(info) {
    state = info;
    $('version').textContent = 'Version ' + info.version;
    $('welcome-dir').textContent = info.dir;
    $('dir').value = info.dir;
    $('dir').title = info.dir;

    if (info.mode === 'uninstall') {
      show('remove');
      return;
    }
    var update = !!info.existing;
    var label = update ? 'Update' : 'Install';
    $('welcome-title').textContent = update ? 'Update Gatehouse' : 'Welcome';
    $('welcome-text').textContent = update
      ? (info.existing.version ? 'Version ' + info.existing.version : 'An older version') + ' is installed. This replaces it with ' + info.version + '.'
      : 'Gatehouse builds circuits and runs real firmware on emulated chips. Setup takes about a minute.';
    $('install').textContent = label;
    $('options-install').textContent = label;
    $('change-dir').hidden = update; // an update goes where the old version is
    show('welcome');
  }

  $('install').addEventListener('click', run);
  $('options-install').addEventListener('click', run);
  $('retry').addEventListener('click', run);
  $('to-options').addEventListener('click', function () {
    show('options');
  });
  $('back').addEventListener('click', function () {
    show('welcome');
  });
  $('change-dir').addEventListener('click', function () {
    host.chooseDir().then(function (r) {
      if (!r || !r.dir) return;
      state.dir = r.dir;
      $('dir').value = r.dir;
      $('dir').title = r.dir;
      $('welcome-dir').textContent = r.dir;
    });
  });
  $('remove').addEventListener('click', run);
  $('keep').addEventListener('click', function () {
    host.close();
  });
  $('launch').addEventListener('click', function () {
    host.launch();
  });
  ['finish', 'error-close', 'close'].forEach(function (id) {
    $(id).addEventListener('click', function () {
      host.close();
    });
  });
  $('minimize').addEventListener('click', function () {
    host.minimize();
  });

  host.info().then(setup);
})();
