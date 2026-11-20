'use strict';
const mongoose = require( 'mongoose' );
const { Schema } = require( 'mongoose' );
const uniqueValidator = require( 'mongoose-unique-validator' );

class MotherCategory {

    initSchema() {
        const schema = new Schema( {
            'name': {
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
            mongoose.model( 'mothercategory', schema );
        } catch ( e ) {

        }

    }

    getInstance() {
        this.initSchema();
        return mongoose.model( 'mothercategory' );
    }
}

module.exports = { MotherCategory };
