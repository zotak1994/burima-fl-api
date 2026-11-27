'use strict';
const mongoose = require( 'mongoose' );
const { Schema } = require( 'mongoose' );
const uniqueValidator = require( 'mongoose-unique-validator' );
const bcrypt = require( 'bcrypt' );
const { PERMISSIONS: ACCESS_PERMISSIONS } = require( '../../utils/access' );
const SALT_WORK_FACTOR = 10;

class User {

    initSchema() {
        const schema = new Schema( {
            'name': {
                'type': String,
                'required': true,
            },
            'email': {
                'type': String,
                'unique': true,
                'required': true,
                'lowercase': true,
                'trim': true
            },
            'phone': {
                'type': String,
                'trim': true
            },
            'password': {
                'type': String,
                'required': true,
                'select': false
            },
            'status': {
                'type': Boolean,
                'required': true,
                'default': true
            },
            'role': {
                'type': String,
                'enum': [ 'admin', 'user' ],
                'required': true,
                'default': 'user'
            },
            // Which outlets a non-admin may work in. An admin is not scoped:
            // the list is left empty on that role and ignored when reading.
            'shops': [ {
                'type': Schema.Types.ObjectId,
                'ref': 'shop'
            } ],
            // Which modules a non-admin may open. Empty means the account can
            // reach nothing until an admin grants something, which is the
            // safe default for a freshly created login.
            'permissions': [ {
                'type': String,
                'enum': ACCESS_PERMISSIONS
            } ],
            // Which enquiries a non-admin user may see/create:
            //   retail    -> customerType 'customer' only
            //   wholesale -> customerType 'wholesaler' only
            //   both      -> no restriction (admins always see everything)
            'enquiryAccess': {
                'type': String,
                'enum': [ 'retail', 'wholesale', 'both' ],
                'default': 'both'
            },
            'otp': {
                'type': String
            },
            'otpExpiry': {
                'type': Date
            }
        }, { 'timestamps': true } );


        // Pre save Hook
        schema.pre( 'save', function( next ) {
            const user = this;
            // only hash the password if it has been modified (or is new)
            if ( this.isModified( 'password' ) || this.isNew ) {
                bcrypt.genSalt( SALT_WORK_FACTOR, ( err, salt ) => {
                    if ( err ) {
                        return next( err );
                    }
                    bcrypt.hash( user.password, salt, ( hashErr, hash ) => {
                        if ( hashErr ) {
                            return next( hashErr );
                        }
                        // override the cleartext password with the hashed one
                        user.password = hash;
                        next();
                    } );
                } );
            } else {
                return next();
            }
        } );

        // Hash the password on the query-update path too. The generic
        // CalmService.update() uses findByIdAndUpdate, which does NOT trigger
        // the 'save' hook above, so without this an admin-updated password
        // would be stored in plain text.
        schema.pre( 'findOneAndUpdate', async function( next ) {
            const update = this.getUpdate() || {};
            const plain = update.password !== undefined
                ? update.password
                : ( update.$set && update.$set.password );
            if ( plain === undefined || plain === null || plain === '' ) {
                return next();
            }
            try {
                const salt = await bcrypt.genSalt( SALT_WORK_FACTOR );
                const hashed = await bcrypt.hash( plain, salt );
                if ( update.$set && update.$set.password !== undefined ) {
                    update.$set.password = hashed;
                } else {
                    update.password = hashed;
                }
                this.setUpdate( update );
                next();
            } catch ( e ) {
                next( e );
            }
        } );

        // Compare Password
        schema.methods.comparePassword = async function( candidatePassword ) {
            return new Promise( ( resolve, reject ) => {
                bcrypt.compare( candidatePassword, this.password, ( err, isMatch ) => {
                    if ( err ) {
                        reject( err );
                    } else {
                        resolve( isMatch );
                    }
                } );
            } );
        };

        schema.statics.findByEmail = function( email ) {
            return this.findOne( { 'email': email } );
        };

        schema.plugin( uniqueValidator );

        try {
            mongoose.model( 'user', schema );
        } catch ( e ) {

        }

    }

    getInstance() {
        this.initSchema();
        return mongoose.model( 'user' );
    }
}

module.exports = { User };
