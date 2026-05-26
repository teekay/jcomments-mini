// Browser script: fetches comments added after build, renders them, and handles form submission.
// Zero dependencies. Uses textContent everywhere to prevent XSS.

(function () {
  'use strict';

  function JComments(options) {
    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.siteKey = options.siteKey;
    this.pageUrl = options.pageUrl || window.location.pathname;
    this.container = document.getElementById(options.containerId || 'jcomments');
    this.form = document.getElementById(options.formId || 'jcomments-form');
    this.buildTimestamp = options.buildTimestamp || null;

    if (this.container) this._loadComments();
    if (this.form) this._bindForm();
  }

  JComments.prototype._loadComments = function () {
    var self = this;
    var params = new URLSearchParams({ url: this.pageUrl });
    if (this.buildTimestamp) params.set('since', this.buildTimestamp);

    fetch(this.endpoint + '/comments?' + params)
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(function (comments) {
        comments.forEach(function (c) { self._renderComment(c); });
      })
      .catch(function () {});
  };

  JComments.prototype._renderComment = function (comment) {
    var el = document.createElement('div');
    el.className = 'jcomment';
    el.dataset.id = comment.id;

    var header = document.createElement('div');
    header.className = 'jcomment-header';

    var author = document.createElement('strong');
    author.className = 'jcomment-author';
    author.textContent = comment.author;

    var time = document.createElement('time');
    time.className = 'jcomment-time';
    time.dateTime = comment.createdAt;
    time.textContent = new Date(comment.createdAt).toLocaleDateString();

    header.appendChild(author);
    header.appendChild(document.createTextNode(' '));
    header.appendChild(time);

    var body = document.createElement('div');
    body.className = 'jcomment-body';
    if (comment.html) {
      body.innerHTML = comment.html;
    } else {
      comment.text.split('\n').forEach(function (line, i) {
        if (i > 0) body.appendChild(document.createElement('br'));
        body.appendChild(document.createTextNode(line));
      });
    }

    el.appendChild(header);
    el.appendChild(body);
    this.container.appendChild(el);
  };

  JComments.prototype._bindForm = function () {
    var self = this;
    this.form.addEventListener('submit', function (e) {
      e.preventDefault();
      var submit = self.form.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;

      var fd = new FormData(self.form);
      var payload = {
        siteKey: self.siteKey,
        url: self.pageUrl,
        author: fd.get('author'),
        text: fd.get('text'),
        website2: fd.get('website2') || '',
      };
      var email = fd.get('email');
      if (email) payload.email = email;

      var turnstile = self.form.querySelector('[name="cf-turnstile-response"]');
      if (turnstile) payload['cf-turnstile-response'] = turnstile.value;

      fetch(self.endpoint + '/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (result) {
          if (result && result.id) {
            self._renderComment({
              id: result.id,
              author: payload.author,
              text: payload.text,
              html: result.html,
              createdAt: new Date().toISOString(),
            });
          }
          self.form.reset();
          if (window.turnstile) window.turnstile.reset();
        })
        .finally(function () {
          if (submit) submit.disabled = false;
        });
    });
  };

  window.JComments = JComments;
})();
