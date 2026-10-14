/* The Share sheet: who can open a map (Private, Anyone with the link,
 * Public), its link with Copy and Reset, and the project members it is
 * shared with — each as Can view or Can edit. Only the map's owner sees the
 * Share button, and every call here is an owner-only route. Loads its own
 * data, so it shows honest loading, error and loaded states. All text
 * reaches the DOM through textContent. */
(function (root) {
  'use strict';
  var api = root.M2Api.api;

  var CHOICES = [
    { value: 'private', title: 'Private', note: 'Only you and the people you add' },
    { value: 'link', title: 'Anyone with the link', note: 'No account needed' },
    { value: 'public', title: 'Public', note: 'Anyone signed in to M2' },
  ];

  var uid = 0; // unique ids for labels, one sheet after another

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function button(cls, text) {
    var b = el('button', cls, text);
    b.type = 'button';
    return b;
  }

  // The native kit when it loaded; plain stand-ins when it did not.
  function kit() {
    return root.unNative || {
      presentSheet: function () { console.log('sheet unavailable'); return { dismiss: function () {} }; },
      toast: function (m) { console.log('toast:', m); return { dismiss: function () {} }; },
    };
  }

  function sheetColumn() {
    var col = el('div');
    col.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:4px 4px 12px';
    return col;
  }

  // Grey rows standing in for a list while it loads.
  function skeletonList(rows) {
    var list = el('ul', 'list');
    for (var i = 0; i < rows; i++) {
      var row = el('li', 'list-row');
      var sk = el('div', 'skeleton');
      sk.style.cssText = 'height:16px;width:' + (60 - i * 12) + '%';
      row.appendChild(sk);
      list.appendChild(row);
    }
    return list;
  }

  function errorState(title, message, retry) {
    var state = el('div', 'state-error');
    state.appendChild(el('p', 'text-body font-semibold', title));
    state.appendChild(el('p', 'text-small text-muted', message));
    var btn = button('btn-secondary', 'Retry');
    btn.addEventListener('click', retry);
    state.appendChild(btn);
    return state;
  }

  function ShareSheet(mapId, title) {
    var un = kit();
    var base = '/api/maps/' + encodeURIComponent(mapId) + '/sharing';
    var readersBase = '/api/maps/' + encodeURIComponent(mapId) + '/readers';
    var n = ++uid;
    var state = null; // { visibility, link, readers: [{ id, username, role }] }

    var wrap = sheetColumn();
    var heading = el('h2', 'text-heading', 'Share ' + title);
    heading.style.overflowWrap = 'anywhere';
    wrap.appendChild(heading);
    var body = el('div');
    body.style.cssText = 'display:flex;flex-direction:column;gap:8px';
    wrap.appendChild(body);
    un.presentSheet({ contentEl: wrap });

    function setLoading() {
      body.textContent = '';
      body.appendChild(el('p', 'section-label', 'Who can open it'));
      body.appendChild(skeletonList(3));
    }

    function setError() {
      body.textContent = '';
      body.appendChild(errorState(
        'Couldn’t load who can open this map.',
        'Nothing has changed. Check your connection and try again.',
        load
      ));
    }

    // ── Loaded ───────────────────────────────────────────────────────────
    var radios = [];
    var field, linkNote, copyBtn, resetBtn, peopleList;

    function renderLoaded() {
      body.textContent = '';
      radios = [];

      var whoLabel = el('p', 'section-label', 'Who can open it');
      whoLabel.id = 'share-who-' + n;
      body.appendChild(whoLabel);
      var group = el('div', 'list');
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-labelledby', whoLabel.id);
      CHOICES.forEach(function (choice) {
        var row = el('label', 'list-row');
        row.style.cursor = 'pointer';
        var input = el('input', 'choice');
        input.type = 'radio';
        input.name = 'share-visibility-' + n;
        input.value = choice.value;
        input.checked = state.visibility === choice.value;
        input.addEventListener('change', function () {
          if (input.checked) choose(choice.value);
        });
        radios.push(input);
        row.appendChild(input);
        var text = el('div');
        text.style.cssText = 'flex:1;min-width:0';
        text.appendChild(el('p', 'text-body font-semibold', choice.title));
        text.appendChild(el('p', 'text-small text-muted', choice.note));
        row.appendChild(text);
        group.appendChild(row);
      });
      body.appendChild(group);

      var linkLabel = el('label', 'section-label', 'Link');
      linkLabel.style.marginTop = '8px';
      field = el('input', 'field');
      field.type = 'text';
      field.readOnly = true;
      linkLabel.htmlFor = field.id = 'share-link-' + n;
      field.addEventListener('focus', function () { field.select(); });
      body.appendChild(linkLabel);
      body.appendChild(field);
      linkNote = el('p', 'text-small text-muted', 'Reset the link to stop the old one working.');
      body.appendChild(linkNote);
      var linkRow = el('div');
      linkRow.style.cssText = 'display:flex;gap:8px';
      copyBtn = button('btn-primary', 'Copy link');
      copyBtn.style.flex = '1';
      copyBtn.addEventListener('click', copyLink);
      resetBtn = button('btn-secondary', 'Reset link');
      resetBtn.addEventListener('click', resetLink);
      linkRow.appendChild(copyBtn);
      linkRow.appendChild(resetBtn);
      body.appendChild(linkRow);

      var peopleLabel = el('p', 'section-label', 'People');
      peopleLabel.style.marginTop = '8px';
      body.appendChild(peopleLabel);
      peopleList = el('ul', 'list');
      body.appendChild(peopleList);
      var addBtn = button('btn-secondary', 'Add people');
      addBtn.addEventListener('click', openAddPeople);
      body.appendChild(addBtn);

      renderLink();
      renderPeople();
    }

    // The link and Reset follow the choice; only a secret link resets.
    function renderLink() {
      field.value = state.link;
      var secret = state.visibility === 'link';
      linkNote.hidden = !secret;
      resetBtn.hidden = !secret;
    }

    function renderPeople() {
      peopleList.textContent = '';
      // The owner first, so the list reads like a room: you, then everyone
      // you let in, with what each may do.
      var you = el('li', 'list-row');
      you.appendChild(el('p', 'text-body font-semibold', 'You'));
      you.appendChild(el('span', 'role-pill', 'Owner'));
      peopleList.appendChild(you);
      if (!state.readers.length) {
        peopleList.appendChild(el('li', 'list-row text-small text-muted', 'No one added yet'));
        return;
      }
      state.readers.forEach(function (reader) {
        var row = el('li', 'list-row');
        var name = el('p', 'text-body font-semibold', reader.username);
        name.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        row.appendChild(name);
        // What they may do, changed with one tap: the button reads the
        // current answer and opens the two choices.
        var roleBtn = button('btn-secondary', reader.role === 'editor' ? 'Can edit' : 'Can view');
        roleBtn.setAttribute('aria-label', 'Change what ' + reader.username
          + ' can do, now ' + (reader.role === 'editor' ? 'Can edit' : 'Can view'));
        roleBtn.addEventListener('click', function () {
          if (root.unNative && root.unNative.popover) {
            roleBtn.disabled = true;
            root.unNative.popover({
              anchorEl: roleBtn,
              items: [
                { label: 'Can view', handler: function () { setRole(reader, 'viewer', roleBtn); } },
                { label: 'Can edit', handler: function () { setRole(reader, 'editor', roleBtn); } },
              ],
            }).then(function () { roleBtn.disabled = false; });
          } else {
            // No kit, no popover: the button itself picks the other role.
            setRole(reader, reader.role === 'editor' ? 'viewer' : 'editor', roleBtn);
          }
        });
        row.appendChild(roleBtn);
        var remove = button('btn-secondary', 'Remove');
        remove.setAttribute('aria-label', 'Remove ' + reader.username);
        remove.addEventListener('click', function () {
          remove.disabled = true;
          api('DELETE', readersBase + '/' + encodeURIComponent(reader.id)).then(function (r) {
            state.readers = r.readers;
            renderPeople();
          }).catch(function () {
            remove.disabled = false;
            un.toast('Couldn’t remove ' + reader.username);
          });
        });
        row.appendChild(remove);
        peopleList.appendChild(row);
      });
    }

    // One PATCH at a time; the sheet re-renders from the answer. A failure
    // puts the button back on what the server holds.
    function setRole(reader, role, roleBtn) {
      api('PATCH', readersBase + '/' + encodeURIComponent(reader.id), { role: role })
        .then(function (r) {
          state.readers = r.readers;
          renderPeople();
        }).catch(function () {
          roleBtn.disabled = false;
          un.toast('Couldn’t change what ' + reader.username + ' can do');
        });
    }

    // ── Who can open it ──────────────────────────────────────────────────
    // One PUT at a time, and the latest choice is sent next, so arrowing
    // through the radios can't leave the server on an older choice. A
    // failure puts the radios back on what the server holds.
    var wanted = null;
    var sending = false;

    function setRadios(value) {
      radios.forEach(function (r) { r.checked = r.value === value; });
    }

    function choose(value) {
      wanted = value;
      if (!sending) sendChoice();
    }

    function sendChoice() {
      if (wanted === state.visibility) return;
      sending = true;
      api('PUT', base, { visibility: wanted }).then(function (r) {
        sending = false;
        state.visibility = r.visibility;
        state.link = r.link;
        renderLink();
        if (wanted !== state.visibility) sendChoice();
      }).catch(function () {
        sending = false;
        wanted = state.visibility;
        setRadios(state.visibility);
        un.toast('Couldn’t change who can open it');
      });
    }

    // ── Link ─────────────────────────────────────────────────────────────
    function copyFailed() {
      field.focus();
      field.select();
      un.toast('Couldn’t copy. Select the link to copy it.');
    }

    function copyLink() {
      var clip = root.navigator && root.navigator.clipboard;
      if (!clip || !clip.writeText) { copyFailed(); return; }
      clip.writeText(state.link).then(function () {
        un.toast('Link copied');
      }, copyFailed);
    }

    function resetLink() {
      resetBtn.disabled = true;
      api('POST', base + '/link').then(function (r) {
        resetBtn.disabled = false;
        state.visibility = r.visibility;
        state.link = r.link;
        renderLink();
      }).catch(function () {
        resetBtn.disabled = false;
        un.toast('Couldn’t reset the link');
      });
    }

    // ── Add people ───────────────────────────────────────────────────────
    // The project's members, as the platform lists them; you can't add
    // anyone outside the project, or yourself (the list leaves you out).
    // One "Add them as" answer applies to every Add pressed while the
    // sheet is open: Can edit first, since sharing for editing is why
    // this sheet got the question.
    function openAddPeople() {
      var col = sheetColumn();
      col.appendChild(el('h2', 'text-heading', 'Add people'));
      var inner = el('div');
      inner.style.cssText = 'display:flex;flex-direction:column;gap:8px';
      col.appendChild(inner);
      un.presentSheet({ contentEl: col });

      var m = ++uid;
      var asRole = 'editor';
      var asChoices = [
        { value: 'editor', title: 'Can edit', note: 'They can change the map' },
        { value: 'viewer', title: 'Can view', note: 'They can look, not change it' },
      ];
      var asLabel = el('label', 'section-label', 'Add them as');
      asLabel.htmlFor = 'share-as-' + m;
      inner.appendChild(asLabel);
      var asGroup = el('div', 'list');
      asGroup.setAttribute('role', 'radiogroup');
      asGroup.setAttribute('aria-labelledby', asLabel.id);
      asChoices.forEach(function (choice) {
        var row = el('label', 'list-row');
        row.style.cursor = 'pointer';
        var input = el('input', 'choice');
        input.type = 'radio';
        input.name = 'share-as-' + m;
        input.value = choice.value;
        input.checked = asRole === choice.value;
        input.addEventListener('change', function () {
          if (input.checked) {
            asRole = choice.value;
            // The Add buttons say what pressing them would do.
            listArea.querySelectorAll('button[aria-label]').forEach(function (b) {
              var label = b.getAttribute('aria-label');
              if (label.indexOf(', as ') !== -1 && label.indexOf('Added ') !== 0) {
                b.setAttribute('aria-label',
                  label.slice(0, label.indexOf(', as ')) + ', as '
                  + (asRole === 'editor' ? 'Can edit' : 'Can view'));
              }
            });
          }
        });
        row.appendChild(input);
        var text = el('div');
        text.style.cssText = 'flex:1;min-width:0';
        text.appendChild(el('p', 'text-body font-semibold', choice.title));
        text.appendChild(el('p', 'text-small text-muted', choice.note));
        row.appendChild(text);
        asGroup.appendChild(row);
      });
      inner.appendChild(asGroup);
      inner.appendChild(el('p', 'section-label', 'Project members'));
      var listArea = el('div');
      listArea.style.cssText = 'display:flex;flex-direction:column;gap:8px';
      inner.appendChild(listArea);

      function isReader(id) {
        return state.readers.some(function (r) { return r.id === id; });
      }

      function addRow(member) {
        var row = el('li', 'list-row');
        var name = el('p', 'text-body font-semibold', member.username);
        name.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        row.appendChild(name);
        var btn = button('btn-secondary', isReader(member.id) ? 'Added' : 'Add');
        btn.disabled = isReader(member.id);
        btn.setAttribute('aria-label', (btn.disabled ? 'Added ' : 'Add ') + member.username
          + ', as ' + (asRole === 'editor' ? 'Can edit' : 'Can view'));
        btn.addEventListener('click', function () {
          btn.disabled = true;
          api('POST', readersBase, { userId: member.id, role: asRole }).then(function (r) {
            state.readers = r.readers;
            renderPeople();
            btn.textContent = 'Added';
            btn.setAttribute('aria-label', 'Added ' + member.username);
          }).catch(function () {
            btn.disabled = false;
            un.toast('Couldn’t add ' + member.username);
          });
        });
        row.appendChild(btn);
        return row;
      }

      function loadMembers() {
        listArea.textContent = '';
        listArea.appendChild(skeletonList(3));
        api('GET', '/api/members').then(function (r) {
          listArea.textContent = '';
          if (!r.available) {
            listArea.appendChild(el('p', 'text-small text-muted',
              'Only project members can be added, and the list isn’t available here.'));
            return;
          }
          if (!r.members.length) {
            listArea.appendChild(el('p', 'text-small text-muted', 'No one else is in this project yet.'));
            return;
          }
          var list = el('ul', 'list');
          list.style.cssText = 'max-height:50vh;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y';
          r.members.forEach(function (mem) { list.appendChild(addRow(mem)); });
          listArea.appendChild(list);
        }).catch(function () {
          listArea.textContent = '';
          listArea.appendChild(errorState(
            'Couldn’t load the project members.',
            'Link sharing still works.',
            loadMembers
          ));
        });
      }

      loadMembers();
    }

    function load() {
      setLoading();
      api('GET', base).then(function (r) {
        state = r;
        wanted = r.visibility;
        renderLoaded();
      }).catch(setError);
    }

    load();
  }

  root.M2ShareSheet = ShareSheet;
})(typeof self !== 'undefined' ? self : this);
