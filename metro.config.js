const { getDefaultConfig } = require('expo/metro-config');
const { withLeanReaderSheets } = require('./metro.leanSheets');

module.exports = withLeanReaderSheets(getDefaultConfig(__dirname), __dirname);
