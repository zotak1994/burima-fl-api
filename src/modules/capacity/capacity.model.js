'use strict';
const mongoose = require( 'mongoose' );
const { Schema } = require( 'mongoose' );
const uniqueValidator = require( 'mongoose-unique-validator' );

class Capacity {

    initSchema() {
        const schema = new Schema( {
            // Display label as printed on the bottle, e.g. '750 ml', '1 L'.
            'name': {
                'type': String,
                'required': true,
                'trim': true
            },
            // Normalised size in millilitres. Kept alongside the label so
            // capacities sort naturally (180 < 375 < 750) regardless of how
            // the label is written.
            'volumeMl': {
                'type': Number,
                'required': true,
                'min': 1
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
            mongoose.model( 'capacity', schema );
        } catch ( e ) {

        }

    }

    getInstance() {
        this.initSchema();
        return mongoose.model( 'capacity' );
    }
}

module.exports = { Capacity };
