'use strict';
/**
 * Custom Config File
 * Override any existing config value in system/config/config.js
 * @type {{}}
 */
module.exports.config = {
    JWT_SECRET: process.env.JWT_SECRET || 'S0M3S3CR3TK3Y',
    JWT_EXPIRY: process.env.JWT_EXPIRY || 864000, //10 days
    PORT: process.env.PORT || 5001
};
