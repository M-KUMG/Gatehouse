'use strict';
// Closing the window with unsaved changes. Electron cannot let the page cancel
// a close, so main.js blocks it and asks the page (which shows the app's own
// "Save changes?" popup: Save / Don't save / Cancel) through three messages:
//
//   main -> page  request   "the user wants to close, ask"
//   page -> main  ack       "got it, I am asking" (sent by the preload at once)
//   page -> main  answer    'close' or 'stay'
//
// If the page does not acknowledge within `waitMs` (it is broken or still
// loading), `fallback` runs: the plain system dialog. No Electron import here,
// so it is tested with fake timers.

const CHANNEL = {
  request: 'gatehouse:close:request',
  ack: 'gatehouse:close:ack',
  answer: 'gatehouse:close:answer',
};

/**
 * @param send        asks the page (a message on CHANNEL.request)
 * @param fallback    the system dialog; it closes the window itself if the user agrees
 * @param forceClose  closes the window without asking again
 */
function createCloseFlow({ send, fallback, forceClose, waitMs = 2500, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let state = 'idle'; // 'waiting' (sent, no ack yet) | 'asking' (the page has it) | 'idle'
  let timer = null;
  const stopTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  return {
    /** The user asked to close a window that has unsaved changes. */
    request() {
      if (state !== 'idle') return; // already asking: a second click on the close button changes nothing
      state = 'waiting';
      send();
      timer = setTimer(() => {
        timer = null;
        if (state !== 'waiting') return;
        state = 'idle';
        fallback();
      }, waitMs);
    },
    /** The page is showing its popup. */
    ack() {
      if (state !== 'waiting') return;
      state = 'asking';
      stopTimer();
    },
    /** The page's answer: 'close' closes, anything else keeps the window. */
    answer(action) {
      if (state === 'idle') return;
      stopTimer();
      state = 'idle';
      if (action === 'close') forceClose();
    },
    get state() {
      return state;
    },
  };
}

module.exports = { CHANNEL, createCloseFlow };
