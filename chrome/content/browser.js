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

var FastPrevNext = {
	log: Components.utils.reportError,

	get content() { return document.getElementById('content'); },
	get urlbar() { return document.getElementById('urlbar'); },

	_pattern: /(\d+)([^\d]*?)$/,
	_flags: Ci.nsIWebNavigation.LOAD_FLAGS_NONE,
	_known: {},

	_buildNum: function(rv, digits) {
		rv = rv.toString();
		if (typeof(digits) != 'number') {
			digits = 3;
		}
		while (rv.length < digits) {
			rv = '0' + rv;
		}
		return rv;
	},

	get enabled() {
		return this.urlbar.hasAttribute('_FastPrevNext_enabled') && this.urlbar.getAttribute('_FastPrevNext_enabled');
	},
	set enabled(nv) {
		nv = !!nv;
		this.urlbar.setAttribute('_FastPrevNext_enabled', nv.toString());
		return nv;
	},

	onMouseEnterUrlbar: function() FastPrevNext.checkEnable(),
	checkEnable: function() {
		if (!this.content.webNavigation || !this.content.webNavigation.currentURI) {
			return;
		}
		let match = this.content.webNavigation.currentURI.spec.match(this._pattern);
		this.enabled = match != null && parseInt(match[1], 10) > 0;
	},

	// XXX: post-processing (error fixups) not implemented
	openNewTab: function(link, ref) {
		try {
			if ('delayedOpenTab' in window) {
				window.delayedOpenTab(link, ref);
				return;
			}
			window.getBrowser().addTab(link, ref);
			return;
		}
		catch (ex) {
			this.log("failed to open link" + ex);
		}
	},

	_move: function(v, newTab) {
		try {
			let cnt = this.content;
			let nav = cnt.webNavigation;
			let spec = nav.currentURI.spec;
			let m = spec.match(this._pattern);
			if (!m) {
				return;
			}
			let num = this._buildNum(parseInt(m[1], 10) + v, m[1].length);
			spec = spec.replace(this._pattern, num + '$2');

			if (newTab) {
				this.openNewTab(spec, nav.referringURI);
				return;
			}

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
			this._goto(spec, num, cnt.selectedBrowser);
		}
		catch (ex) {
			this.log(ex);
		}
	},

	_goto: function(spec, num, browser) {
		// when we have a leading zero then we may later want to re-try without it.
		if (num.match(/^0/)) {
			let now = Date.now();

			// some garbage collection
			let cut = now - 900;
			for (let x in this._known) {
				if (this._known[x][2] < cut) {
					delete this._known[x][2];
				}
			}

			// store, so that we later may retry
			this._known[spec] = [num, browser, now];
		}
		let nav = browser.webNavigation;
		nav.loadURI(spec, this._flags, nav.referringURI, null, null);
	},

	// load handler doing the post-processing
	// right now this includes error handling/re-trying
	load: function(evt) FastPrevNext._load(evt),
	_load: function(evt) {
		let loc = evt.originalTarget.location.toString();
		if (!(loc in this._known)) {
			return;
		}
		let [num, browser] = this._known[loc];
		delete this._known[loc];

		if (!browser) {
			return;
		}

		// error checking
		let error = false;
		try {
			// check for http 40x
			if (browser.docShell && browser.docShell.currentDocumentChannel && (browser.docShell.currentDocumentChannel instanceof Ci.nsIHttpChannel)) {
				let http = browser.docShell.currentDocumentChannel.QueryInterface(Ci.nsIHttpChannel);
				error = (http.responseStatus % 100) == 4;
			}
			// XXX: check for neterror as well?
		}
		catch (ex) {
			this.log(ex);
		}
		if (!error) {
			return;
		}

		num = num.replace(/^0/, '');
		spec = loc.replace(this._pattern, num + '$2');
		if (spec != loc) {
			this._goto(spec, num, browser);
		}
		return true;
	},

	next: function(evt) {
		this._move(1, evt.button == 1);
	},
	prev: function(evt) {
		this._move(-1, evt.button == 1);
	}
};

// add this so that we can later post-process
(function() {
		addEventListener('DOMContentLoaded', FastPrevNext.load, true);
		addEventListener('load', function() {
			removeEventListener('load', arguments.callee, false);
			FastPrevNext.urlbar.addEventListener('mousemove', FastPrevNext.onMouseEnterUrlbar, true);
		}, false);
})();