'use strict';

class GetDTO {
    constructor( { ...props } ) {
        this._id = props._id;
        this.name = props.name;
        this.email = props.email;
        this.phone = props.phone;
        this.status = props.status;
        this.role = props.role;
        this.enquiryAccess = props.enquiryAccess;

        // Auto Generated Fields
        this.createdAt = props.createdAt;
        this.updatedAt = props.updatedAt;
        Object.freeze( this );
    }
}
class InsertDTO {
    constructor( { ...props } ) {
        this.name = props.name;
        this.email = props.email;
        this.phone = props.phone;
        this.password = props.password;
        this.status = props.status;
        this.role = props.role;
        this.enquiryAccess = props.enquiryAccess;
        Object.freeze( this );
    }
}

class UpdateDTO {
    constructor( { ...props } ) {
        this.name = props.name;
        this.email = props.email;
        this.phone = props.phone;
        this.password = props.password;
        this.status = props.status;
        this.role = props.role;
        this.enquiryAccess = props.enquiryAccess;

        // Delete Fields which are not present in data
        Object.keys( this ).forEach( key => {
            if ( this[ key ] === undefined ) {
                delete this[ key ];
            }
        } );
        Object.freeze( this );
    }
}


module.exports = { GetDTO, InsertDTO, UpdateDTO };
