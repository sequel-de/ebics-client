'use strict';

// EBICS technical/business return codes are the standard set shared across
// protocol versions (H003/H004/H005) - re-exporting H004's table rather than
// duplicating it. This has not been diffed line-by-line against the H005
// specification's own error code appendix, so treat an unexpected or
// missing code as a signal to check that appendix rather than assuming this
// table is exhaustive for H005.
module.exports = require('../H004/errors');
