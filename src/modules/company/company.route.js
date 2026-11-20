'use strict';
const CompanyController = require( './company.controller' );
const AuthController = require( '../auth/auth.controller' );
const express = require( 'express' );
const router = express.Router();

/**
 * Reads are public (the storefront catalogue needs them).
 * Writes require a valid admin JWT (Authorization: Bearer <token>).
 */
router.get( '/', CompanyController.getAll );
router.get( '/:id', CompanyController.get );
router.post( '/', AuthController.checkLogin, CompanyController.insert );
// NOTE: must be declared before '/:id' so 'reorder' isn't captured as an id.
router.put( '/reorder', AuthController.checkLogin, CompanyController.reorder );
router.put( '/:id', AuthController.checkLogin, CompanyController.update );
router.delete( '/:id', AuthController.checkLogin, CompanyController.delete );


module.exports = router;
