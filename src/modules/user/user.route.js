'use strict';
const UserController = require( './user.controller' );
const AuthController = require( '../auth/auth.controller' );
const express = require( 'express' );
const router = express.Router();

/**
 * Admin users CRUD. Every route requires a valid admin JWT
 * (Authorization: Bearer <token>). Passwords are hashed on create
 * and never returned.
 */
router.use( AuthController.checkLogin );

router.get( '/', UserController.getAll );
router.get( '/:id', UserController.get );
router.post( '/', UserController.insert );
router.put( '/:id', UserController.update );
router.delete( '/:id', UserController.delete );


module.exports = router;
