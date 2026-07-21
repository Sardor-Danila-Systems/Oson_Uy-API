// Nest builds with the webpack builder (see nest-cli.json). Native modules
// like `sharp` (which loads a platform-specific *.node binary via the
// @img/sharp-* packages) must NOT be bundled — webpack would rewrite their
// dynamic requires and the binary would fail to load at runtime, surfacing as
// "The image is corrupted or in an unsupported format." Keeping them external
// makes the bundle `require('sharp')` straight from node_modules as normal.
module.exports = (options) => {
  const externals = [];
  if (Array.isArray(options.externals)) externals.push(...options.externals);
  else if (options.externals) externals.push(options.externals);

  externals.push(({ request }, callback) => {
    if (request === 'sharp' || request.startsWith('@img/')) {
      return callback(null, 'commonjs ' + request);
    }
    return callback();
  });

  return {
    ...options,
    externals,
  };
};
