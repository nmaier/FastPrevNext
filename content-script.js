/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

/* global
    docShell,
    content,
    sendAsyncMessage,
    addMessageListener,
    removeMessageListener
*/

(function() {

const {interfaces: Ci} = Components;

const load = evt => {
  let chan = docShell.currentDocumentChannel;
  let loc;
  try {
    loc = chan.originalURI.spec;
    if (chan.URI.spec == loc && chan instanceof Ci.nsIHttpChannel &&
        chan.responseStatus / 100 < 3) {
      // skip
      return;
    }
  }
  catch (ex) {
    return;
  }
  sendAsyncMessage("fastprevnext:loaded", {loc: loc}, {document: evt.target});
};

addEventListener("DOMContentLoaded", load, true);

const meta = () => {
  let rv = content.document.querySelectorAll("head > link[rel]");
  rv = Array.map(rv, e => { return {rel: e.rel, href: e.href}; });
  sendAsyncMessage("fastprevnext:meta", rv);
};

const shutdown = () => {
  removeEventListener("DOMContentLoaded", load, true);
  removeMessageListener("fastprevnext:meta", meta);
  removeMessageListener("fastprevnext:shutdown", shutdown);
};

addMessageListener("fastprevnext:meta", meta);
addMessageListener("fastprevnext:shutdown", shutdown);

})();
