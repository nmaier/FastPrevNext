/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const {registerOverlay, unloadWindow} = require("windows");

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

registerOverlay(
  "fastprevnext.xul",
  "chrome://browser/content/browser.xul",
  function main(window, document) {
    function $(id) document.getElementById(id);
    function $$(q) document.querySelector(q);
    function $$$(q) document.querySelectorAll(q);

    let ss = document.createProcessingInstruction("xml-stylesheet", "href='chrome://fastprevnext/skin/' type='text/css'");
    ss.contexts = [];
    document.documentElement.parentNode.insertBefore(ss, document.documentElement);
    unloadWindow(window, function() ss.parentNode.removeChild(ss));

    let urlbar = $("urlbar");
    let content = $("content");

    let known = Object.create(null);
    unloadWindow(window, function() known = null);

    (function() {
      function setEnabled(nv) {
        nv = !!nv;
        urlbar.setAttribute("_FastPrevNext_enabled", nv.toString());
      }
      function checkEnableMetaLinks() {
        let links = content.contentDocument.querySelectorAll("head > link");
        return Array.some(links, function(l) l.rel == "next" || l.rel == "previous");
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
      function getDestURI(dir) {
        let links = content.contentDocument.querySelectorAll("head > link");
        for (let i = 0, e = links.length; i != e; ++i) {
          let l = links[i];
          if ((dir == NEXT && l.rel == "next") || (dir == PREV && l.rel == "previous")) {
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
        window.XULBrowserWindow.setOverLink(dir ? getDestURI(dir) : "", null);
      }
      function moveTo(dir, newTab) {
        try {
          let nav = content.webNavigation;
          let spec = getDestURI(dir);
          if (!spec) {
            throw new Error("Cannot determine next page");
          }
          if (newTab) {
            openNewTab(spec, nav.referringURI);
            return;
          }

          // Already in history?
          let sh = nav.sessionHistor;
          if (sh && sh.count > 1) {
            for (let i = sh.count - 1; i >= 0; --i) {
              let entry = sh.getEntryAtIndex(i, false);
              if (entry && entry.URI.spec == spec) {
                nav.gotoIndex(i);
                return;
              }
            }
          }

          // Regular navigation
          gotoLink(spec, content.selectedBrowser);
        }
        catch (ex) {
          log(LOG_ERROR, "failed to navigate", ex);
        }
      }

      function gotoLink(spec, browser) {
        let m = spec.match(RE_NUMERIC);
        if (!checkEnableMetaLinks() && m[1].match(/^0+./)) {
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
      }
      function loadPage(evt) {
        let browser = window.gBrowser.getBrowserForDocument(evt.target);
        if (!browser) {
          return;
        }
        let chan = browser.docShell.currentDocumentChannel;
        let loc;
        try {
          loc = chan.originalURI.spec;
          if (chan.URI.spec == chan.originalURI.spec
              && (!(chan instanceof Ci.nsIHttpChannel) || (chan.responseStatus / 100) < 3)) {
            log(LOG_DEBUG, "skipping " + loc + " / " + chan.responseStatus);
            return;
          }
        }
        catch (ex) {
          log(LOG_DEBUG, "failed to get location", ex);
          return;
        }
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
      function updateEnabled() setEnabled(checkEnableMetaLinks() || checkEnableURIMatching());
      function moveNext(evt) moveTo(NEXT, evt.button == 1);
      function movePrev(evt) moveTo(PREV, evt.button == 1);

      content.addEventListener("DOMContentLoaded", loadPage, true);
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
        content.removeEventListener("DOMContentLoaded", loadPage, true);
        urlbar.removeEventListener("mousemove", updateEnabled, true);
        nodePrev.removeEventListener("click", movePrev, true);
        nodePrev.removeEventListener("mouseover", setPreviewLinkPrev, true);
        nodePrev.removeEventListener("mouseout", setPreviewLinkPrev, true);
        nodeNext.removeEventListener("click", moveNext, true);
        nodeNext.removeEventListener("mouseover", setPreviewLinkNext, true);
        nodeNext.removeEventListener("mouseout", setPreviewLinkNext, true);
        content = urlbar = nodePrev = nodeNext = setPreviewLinkPrev = setPreviewLinkNext = null;
      });
    })();

    log(LOG_INFO, "all good!");
});

/* vim: set et ts=2 sw=2 : */
