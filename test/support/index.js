// setup global chai methods
import chai from 'chai';
import dirtyChai from 'dirty-chai';
chai.config.includeStack = true;
chai.config.showDiff = true;
chai.use(dirtyChai);
global.expect = chai.expect;
