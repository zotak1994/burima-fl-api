'use strict';
const UserController = require( './user.controller' );
const AuthController = require( '../auth/auth.controller' );
const { requireAdmin } = require( '../../utils/access' );
const express = require( 'express' );
const router = express.Router();

/**
 * Portal accounts CRUD. Every route requires a valid JWT
 * (Authorization: Bearer <token>) AND the admin role — an account that could
 * read or edit this list could grant itself anything. Passwords are hashed on
 * create and never returned.
 *
 * A signed-in account reads its own details from /auth/profile, not here.
 */
router.use( AuthController.checkLogin );
router.use( requireAdmin );

router.get( '/', UserController.getAll );
router.get( '/:id', UserController.get );
router.post( '/', UserController.insert );
router.put( '/:id', UserController.update );
router.delete( '/:id', UserController.delete );


module.exports = router;
