/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const {registerOverlay, unloadWindow} = require("sdk/windows");
const {Task} = Cu.import("resource://gre/modules/Task.jsm", {});

const PREV = -1;
const CLEAR = 0;
const NEXT = 1;
const RE_NUMERIC = /(\d+)([^\d]*?)$/;
const LOAD_FLAGS = Ci.nsIWebNavigation.LOAD_FLAGS_NONE;

/**
 * Format an integer according to the number of digits given
 *
 * @usage formatNumber(1, 3) == "003"
 * @param {Number} rv Number to format
 * @param {Number} digits [Optional] Number of digits to use
 */
function formatNumber(rv, digits) {
  rv = rv.toString();
  if (typeof(digits) != 'number') {
    digits = 3;
  }
  while (rv.length < digits) {
    rv = '0' + rv;
  }
  return rv;
}

function main(window, document) {
  function $(id) {
    return document.getElementById(id);
  }

  const {gBrowser} = window;

  let ss = document.createProcessingInstruction(
    "xml-stylesheet", "href='chrome://fastprevnext/skin/' type='text/css'");
  document.documentElement.parentNode.insertBefore(ss,
                                                   document.documentElement);
  unloadWindow(window, () => ss.parentNode.removeChild(ss));

  let urlbar = $("urlbar");
  let content = $("content");

  let known = Object.create(null);
  unloadWindow(window, () => known = null);

  (function() {
    function setEnabled(nv) {
      nv = !!nv;
      urlbar.setAttribute("_FastPrevNext_enabled", nv.toString());
    }
    function getMetaLinks() {
      return new Promise(function(r) {
        let mm = gBrowser.selectedBrowser.messageManager;
        let cb = m => {
          mm.removeMessageListener("fastprevnext:meta", cb);
          r(m.data);
        };
        mm.addMessageListener("fastprevnext:meta", cb);
        mm.sendAsyncMessage("fastprevnext:meta");
      });
    }
    function* checkEnableMetaLinks() {
      let links = yield getMetaLinks();
      return Array.some(links, l => l.rel == "next" || l.rel == "previous");
    }
    function checkEnableURIMatching() {
      if (!content.webNavigation || !content.webNavigation.currentURI) {
        return false;
      }
      let match = content.webNavigation.currentURI.spec.match(RE_NUMERIC);
      return match != null && parseInt(match[1], 10) > 0;
    }
    function openNewTab(link, ref) {
      // XXX: post-processing (error fixups) not implemented
      try {
        if ("delayedOpenTab" in window) {
          window.delayedOpenTab(link, ref);
          return;
        }
        window.getBrowser.addTab(link, ref);
        return;
      }
      catch (ex) {
        log(LOG_ERROR, "failed to open link", ex);
      }
    }
    function* getDestURI(dir) {
      let links = yield getMetaLinks();
      for (let i = 0, e = links.length; i != e; ++i) {
        let l = links[i];
        if ((dir == NEXT && l.rel == "next") ||
            (dir == PREV && l.rel == "previous")) {
          return l.href;
        }
      }
      let spec = content.webNavigation.currentURI.spec;
      let m = spec.match(RE_NUMERIC);
      if (!m) {
        return null;
      }
      let num = parseInt(m[1], 10) + dir;
      num = formatNumber(num, m[1].length);
      return spec.replace(RE_NUMERIC, num + "$2");
    }
    function setPreviewLink(dir, event) {
      if (!window.XULBrowserWindow || !window.XULBrowserWindow.setOverLink) {
        return;
      }
      dir = event.type == "mouseout" ? CLEAR : dir;
      if (!dir) {
        window.XULBrowserWindow.setOverLink("", null);
        return;
      }
      Task.spawn(function*() {
        window.XULBrowserWindow.setOverLink((yield getDestURI(dir)), null);
      });
    }
    function moveTo(dir, button) {
      if (button == 2) {
        return;
      }
      Task.spawn(function*() {
        try {
          let spec = yield getDestURI(dir);
          if (!spec) {
            throw new Error("Cannot determine next page");
          }
          if (button == 1) {
            openNewTab(spec, content.webNavigation.referringURI);
            return;
          }

          // Already in history?
          // XXX This yields unsafe CPOW atm.
          // However, same happens in the browser.
          // Waiting for Nightly to settle on something, before addressing
          // This stuff is written a bit insanely in order to avoid generating
          // too many unique messages in the console
          let sh = content.webNavigation.sessionHistory;
          let count = 0;
          if (sh && (count = sh.count) > 1) {
            for (let i = count; ~(--i);) {
              if (sh.getEntryAtIndex(i, false).URI.spec == spec) { content.webNavigation.gotoIndex(i); return; }
            }
          }

          // Regular navigation
          gotoLink(spec, content.selectedBrowser);
        }
        catch (ex) {
          log(LOG_ERROR, "failed to navigate", ex);
        }
      });
    }

    function gotoLink(spec, browser) {
      Task.spawn(function*() {
        let m = spec.match(RE_NUMERIC);
        if (!(yield checkEnableMetaLinks()) && m[1].match(/^0+./)) {
          let now = Date.now();
          let cut = now - 5000;
          for (let x in known) {
            if (known[x][1] < cut) {
              delete known[x];
            }
          }
          known[spec] = [m[1], now];
        }
        let nav = browser.webNavigation;
        nav.loadURI(spec, LOAD_FLAGS, nav.referringURI, null, null);
      });
    }
    function loadPage(m) {
      let {loc} = m.data;
      let {document} = m.objects;
      let browser = window.gBrowser.getBrowserForDocument(document);
      log(LOG_DEBUG, "processing: " + loc);
      if (!(loc in known)) {
        log(LOG_DEBUG, loc + " not in " + Object.keys(known));
        return;
      }
      let [num] = known[loc];
      delete known[loc];

      num = num.replace(/^0+/, "");
      if (!num) {
        return;
      }
      let spec = loc.replace(RE_NUMERIC, num + "$2");
      if (spec != loc) {
        gotoLink(spec, browser);
      }
    }
    function updateEnabled() {
      Task.spawn(function*() {
        setEnabled(checkEnableURIMatching() || (yield checkEnableMetaLinks()));
      });
    }
    function moveNext(evt) {
      moveTo(NEXT, evt.button);
    }
    function movePrev(evt) {
      moveTo(PREV, evt.button);
    }

    window.messageManager.addMessageListener("fastprevnext:loaded", loadPage);
    let fs = "chrome://fastprevnext/content/content-script.js?" + (+new Date());
    window.messageManager.loadFrameScript(fs, true);
    urlbar.addEventListener("mousemove", updateEnabled, true);

    let nodePrev = $("FastPrevNextPrev");
    let setPreviewLinkPrev = setPreviewLink.bind(null, PREV);
    nodePrev.addEventListener("click", movePrev, true);
    nodePrev.addEventListener("mouseover", setPreviewLinkPrev, true);
    nodePrev.addEventListener("mouseout", setPreviewLinkPrev, true);

    let nodeNext = $("FastPrevNextNext");
    let setPreviewLinkNext = setPreviewLink.bind(null, NEXT);
    nodeNext.addEventListener("click", moveNext, true);
    nodeNext.addEventListener("mouseover", setPreviewLinkNext, true);
    nodeNext.addEventListener("mouseout", setPreviewLinkNext, true);

    unloadWindow(window, function() {
      window.messageManager.removeDelayedFrameScript(fs);
      window.messageManager.removeMessageListener("fastprevnext:loaded",
                                                  loadPage);
      window.messageManager.broadcastAsyncMessage("fastprevnext:shutdown");

      urlbar.removeEventListener("mousemove", updateEnabled, true);
      nodePrev.removeEventListener("click", movePrev, true);
      nodePrev.removeEventListener("mouseover", setPreviewLinkPrev, true);
      nodePrev.removeEventListener("mouseout", setPreviewLinkPrev, true);
      nodeNext.removeEventListener("click", moveNext, true);
      nodeNext.removeEventListener("mouseover", setPreviewLinkNext, true);
      nodeNext.removeEventListener("mouseout", setPreviewLinkNext, true);
      content = urlbar = nodePrev = nodeNext = setPreviewLinkPrev =
        setPreviewLinkNext = null;
    });
  })();
  log(LOG_INFO, "all good!");
}

registerOverlay(
  "fastprevnext.xul",
  "chrome://browser/content/browser.xul",
  main
);
registerOverlay(
  "fastprevnext.xul",
  "chrome://navigator/content/navigator.xul",
  main
);

/* vim: set et ts=2 sw=2 : */
