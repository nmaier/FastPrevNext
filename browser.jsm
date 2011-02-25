/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is FastPrevNext
 *
 * The Initial Developers of the Original Code is Nils Maier
 * Portions created by the Initial Developers are Copyright (C) 2008
 * the Initial Developers. All Rights Reserved.
 *
 * Contributor(s):
 *    Nils Maier <MaierMan@web.de>
 *    Denis Jasselette
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const EXPORTED_SYMBOLS = ['main'];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const module = Cu.import;
const log = Cu.reportError;

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

/**
 * Module Entry Point
 */
function main(window) {
  let known = {};

  let document = window.document;
  let XULBrowserWindow = window.XULBrowserWindow;

  function $(id) document.getElementById(id);
  let urlbar = $('urlbar');
  let content = $('content');

  /**
   * Enables or disables the UI elements
   */
  function setEnabled(nv) {
    nv = !!nv;
    urlbar.setAttribute('_FastPrevNext_enabled', nv.toString());
  }

  /**
   * Checks for valid meta-data links
   */
  function checkEnableMetaLinks() {
    let links = content.contentDocument.querySelectorAll('head > link');
    return Array.some(
      links,
      function(e) ['next', 'previous'].indexOf(e.rel) != -1
      );
  }

  /**
   * Checks if sequencing could be applied
   */
  function checkEnableURIMatching() {
    if (!content.webNavigation || !content.webNavigation.currentURI) {
      return;
    }
    let match = content.webNavigation.currentURI.spec.match(RE_NUMERIC);
    return match != null && parseInt(match[1], 10) > 0;
  }

  /**
   * Open a link in a new tab
   *
   * @usage openNewTab("http//example.org/")
   * @param {string} link URL to open
   * @param {nsIURI} ref [Optional] Referrer URI
   */
  function openNewTab(link, ref) {
    // XXX: post-processing (error fixups) not implemented
    try {
      if ('delayedOpenTab' in window) {
        window.delayedOpenTab(link, ref);
        return;
      }
      window.getBrowser().addTab(link, ref);
      return;
    }
    catch (ex) {
      log("failed to open link" + ex);
    }
  }

  /**
   * Display or hide a preview link
   *
   * @usage setPreviewLink(event, "http://example.org/")
   * @usage setPreviewLink()
   * @param {Event} event [Optional] Event leading to the invocation
   * @param {Number} dir [Optional] Direction relative to current location or 0 (hide link)
   */
  function setPreviewLink(event, dir) {
    if (!XULBrowserWindow) {
      return;
    }
    XULBrowserWindow.setOverLink(
      dir ? getDestUrl(dir) : "",
      null);
  }

  /**
   * Compute destination based on the current location
   *
   * @param {Number} dir Directory to go
   */
  function getDestUrl(dir) {
    let links = content.contentDocument.querySelectorAll('head > link');
    for each (var l in links) {
      if ((dir == NEXT && l.rel == 'next')
          || (dir == PREV && l.rel == 'previous')) {
        return l.href;
      }
    }

    let nav = content.webNavigation;
    let spec = nav.currentURI.spec;
    let m = spec.match(RE_NUMERIC);
    if (!m) {
      return null;
    }
    num = parseInt(m[1], 10) + dir;
    num = formatNumber(num, m[1].length);
    return spec.replace(RE_NUMERIC, num + '$2');
  }

  /**
   * Move in URL sequence.
   * This might utialize browser history to navigate
   *
   * @param {Number} dir Direction
   * @param {Boolean} newTab Open in a new Tab
   */
  function moveTo(dir, newTab) {
    try {
      let nav = content.webNavigation;

      let spec = getDestUrl(dir);
      if (!spec) {
        return;
      }

      if (newTab) {
        openNewTab(spec, nav.referringURI);
        return;
      }

      // Find in history
      let sh = nav.sessionHistory;
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
      log(ex);
    }
  }

  /**
   * Go to a link, using a specific browser and without involving history
   *
   * @param {String} spec URI to move to
   * @param {Element} browser Browser element to operate on
   */
  function gotoLink(spec, browser) {
    // when we have a leading zero then we may later want to re-try without it.
    let m = spec.match(RE_NUMERIC);
    if (!checkEnableMetaLinks() && m[1].match(/^0/)) {
      let now = Date.now();

      // some garbage collection
      let cut = now - 900;
      for (let x in known) {
        if (known[x][2] < cut) {
          delete known[x][2];
        }
      }

      // store, so that we later may retry
      known[spec] = [num, browser, now];
    }
    let nav = browser.webNavigation;
    nav.loadURI(spec, LOAD_FLAGS, nav.referringURI, null, null);
  }

  /**
   * Event-Listener: Page loading.
   * Will check for failures and re-navigate if possible
   */
  function loadPage(evt) {
    let loc = evt.originalTarget.location.toString();
    if (!(loc in known)) {
      return;
    }

    let [num, browser] = known[loc];
    delete known[loc];

    if (!browser) {
      return;
    }

    try {
      // check for http 40x
      if (browser.docShell && browser.docShell.currentDocumentChannel && (browser.docShell.currentDocumentChannel instanceof Ci.nsIHttpChannel)) {
        let http = browser.docShell.currentDocumentChannel.QueryInterface(Ci.nsIHttpChannel);
        if ((http.responseStatus % 100) != 4) {
          return;
        }
      }
      // XXX: check for neterror as well?
    }
    catch (ex) {
      log(ex);
    }

    num = num.replace(/^0/, '');
    spec = loc.replace(RE_NUMERIC, num + '$2');
    if (spec != loc) {
      gotoLink(spec, num, browser);
    }
  }

  /**
   * Event-Listener: Updates the UI elements according to possible sequencing
   */
  function updateEnabled() setEnabled(checkEnableMetaLinks() || checkEnableURIMatching());

  /**
   * Event-Listener: Move to next
   */
  function moveNext(evt) moveTo(NEXT, evt.button == 1);
  /**
   * Event-Listener: Move to previous
   */
  function movePrev(evt) moveTo(PREV, evt.button == 1);

  content.addEventListener("load", loadPage, true);
  urlbar.addEventListener("mousemove", updateEnabled, true);

  let node = $("FastPrevNextPrev");
  node.addEventListener("click", movePrev, true);
  node.addEventListener(
    "mouseover",
    function(event) setPreviewLink(event, PREV),
    true
    );
  node.addEventListener(
    "mouseout",
    function(event) setPreviewLink(event, CLEAR),
    true
    );
  node = $("FastPrevNextNext");
  node.addEventListener("click", moveNext, true);
  node.addEventListener(
    "mouseover",
    function(event) setPreviewLink(event, NEXT),
    true
    );
  node.addEventListener(
    "mouseout",
    function(event) setPreviewLink(event, CLEAR),
    true
    );

} // main
