'use strict';
const express = require('express');
const helmet = require( 'helmet' );
const cors = require('cors');
const server = express();
const { setRoutes } = require('./routing');
// Apply Helmet Security
server.use(helmet());
// CORS Configuration
// Expose Content-Disposition so the browser can read the server-set download
// filename (e.g. timestamped exports) from fetch/XHR responses.
server.use(cors({ origin: '*', exposedHeaders: [ 'Content-Disposition' ] }));
// Setup Body Parser
server.use(express.json());
server.use(express.urlencoded({ extended: true }));

// Setup Routes
setRoutes(server);
module.exports = {
    server
};
