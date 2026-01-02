module.exports = {
  prettier: true,
  space: true,
  extends: ['xo-lass'],
  overrides: [
    {
      files: 'test/**/*.js',
      rules: {
        'n/no-unsupported-features/node-builtins': 'off'
      }
    }
  ]
};
