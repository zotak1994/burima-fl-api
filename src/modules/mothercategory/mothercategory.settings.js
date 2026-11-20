'use strict';
/**
 * If custom router url is required, export url as "moduleRoute"
 *
 * Without this the folder name would pluralise to '/mothercategories';
 * the hyphenated form keeps the URL readable and matches the admin's routes.
 */
module.exports = {
    'moduleRoute': 'mother-categories'
};
