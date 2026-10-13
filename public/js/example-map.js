/* The "Welcome to M2" example map, built with the model's own placement rules
 * so it comes out laid out like any map a person would draw. UMD:
 * window.M2Example, or module.exports. Used by the server's welcome route,
 * the Add the example map button, and guest mode. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { exampleDoc: factory(require('./map-model')) };
  } else {
    root.M2Example = { exampleDoc: factory(root.M2Model) };
  }
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  function exampleDoc() {
    var doc = { v: 1, nodes: [{ id: 'root', parent: null, text: 'Welcome to M2', x: 0, y: 0 }] };
    var add = function (parent, text) { return M.addIdea(doc, parent, text).id; };
    var adding = add('root', 'Add ideas');
    var moving = add('root', 'Move things');
    var renaming = add('root', 'Rename');
    var colours = add('root', 'Colours');
    var tidy = add('root', 'Tidy up');
    add(adding, 'Select an idea');
    add(adding, 'Add idea, then type');
    add(moving, 'Drag any idea');
    add(moving, 'Its ideas come along');
    add(renaming, 'Double tap an idea');
    add(colours, 'Each main idea gets its own');
    add(tidy, 'Delete what you don’t need');
    M.layout(doc);
    // Tidying rewrites the array into screen order (right side top to
    // bottom, then left), so the colours picked at add time no longer sit
    // on the array's first five branches: number them in the tidied order.
    M.childrenOf(doc, 'root').forEach(function (n, i) { n.color = i; });
    doc.layout = { auto: true }; // the example map starts kept tidy (#18)
    return doc;
  }

  return exampleDoc;
});
