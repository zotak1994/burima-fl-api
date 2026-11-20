'use strict';
const mongoose = require( 'mongoose' );
const { Schema } = require( 'mongoose' );
const uniqueValidator = require( 'mongoose-unique-validator' );

class Shop {

    initSchema() {
        const schema = new Schema( {
            'name': {
                'type': String,
                'required': true,
                'trim': true
            },
            'phone': {
                // Contact number for the outlet. Kept as a string so leading
                // zeros and any formatting the admin types are preserved.
                'type': String,
                'required': true,
                'trim': true
            },
            'displayNumber': {
                'type': Number,
                'default': 0,
                'index': true
            },
            'status': {
                'type': Boolean,
                'default': true
            },
            'createdBy': {
                'type': Schema.Types.ObjectId,
                'ref': 'user'
            },
            'updatedBy': {
                'type': Schema.Types.ObjectId,
                'ref': 'user'
            }
        }, { 'timestamps': true } );

        schema.plugin( uniqueValidator, { 'message': '{PATH} already exists' } );
        try {
            mongoose.model( 'shop', schema );
        } catch ( e ) {

        }

    }

    getInstance() {
        this.initSchema();
        return mongoose.model( 'shop' );
    }
}

module.exports = { Shop };
