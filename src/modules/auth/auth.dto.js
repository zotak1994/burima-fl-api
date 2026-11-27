'use strict';
const { GetDTO } = require( '../user/user.dto' );

class LoginRequestDTO {
    constructor( { ...props } ) {
        this.email = props.email ? props.email.toLowerCase() : undefined;
        this.password = props.password;
        Object.freeze( this );
    }
}

class LoginResponseDTO {
    constructor( { ...props } ) {
        this.token = props.token;
        this.user = new GetDTO( props.user );
        Object.freeze( this );
    }
}

/**
 * Public self-registration.
 *
 * `role`, `shops` and `permissions` are deliberately NOT read from the body.
 * This endpoint needs no token, so honouring a role here would let anyone
 * create themselves an administrator and walk straight past every other check
 * in the API. The service pins the new account to an unprivileged `user` with
 * no grants; an admin hands out access from the Users screen afterwards.
 */
class RegisterRequestDTO {
    constructor( { ...props } ) {
        this.email = props.email ? props.email.toLowerCase() : undefined;
        this.name = props.name;
        this.password = props.password;

        // Delete Fields which are not present in data
        Object.keys( this ).forEach( key => {
            if ( this[ key ] === undefined ) {
                delete this[ key ];
            }
        } );
        Object.freeze( this );
    }
}

class RegisterResponseDTO extends GetDTO {
    constructor( { ...props } ) {
        super( props );
    }
}

class JWTSignDTO {
    constructor( { ...props } ) {
        this._id = props._id.toString();
        this.email = props.email;
        this.name = props.name;
        this.role = props.role;
        Object.freeze( this );
    }
}

module.exports = { LoginRequestDTO, LoginResponseDTO, RegisterRequestDTO, RegisterResponseDTO, JWTSignDTO };
