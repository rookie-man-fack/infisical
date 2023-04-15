import { Types } from 'mongoose';
import {
    User,
    IUser,
    ServiceAccount,
    IServiceAccount,
    ServiceTokenData,
    IServiceTokenData,
    Secret,
    ISecret,
    SecretBlindIndexData,
} from '../models';
import {
    validateMembership
} from '../helpers/membership';
import {
    validateUserClientForSecret,
    validateUserClientForSecrets
} from '../helpers/user';
import {
    validateServiceTokenDataClientForSecrets, validateServiceTokenDataClientForWorkspace
} from '../helpers/serviceTokenData';
import {
    validateServiceAccountClientForSecrets,
    validateServiceAccountClientForWorkspace
} from '../helpers/serviceAccount';
import { 
    BadRequestError, 
    UnauthorizedRequestError,
    SecretNotFoundError
} from '../utils/errors';
import {
    AUTH_MODE_JWT,
    AUTH_MODE_SERVICE_ACCOUNT,
    AUTH_MODE_SERVICE_TOKEN,
    AUTH_MODE_API_KEY
} from '../variables';
import crypto from 'crypto';
import * as argon2 from 'argon2';


/**
 * Validate authenticated clients for secrets with id [secretId] based
 * on any known permissions.
 * @param {Object} obj
 * @param {Object} obj.authData - authenticated client details
 * @param {Types.ObjectId} obj.secretId - id of secret to validate against
 * @param {Array<'admin' | 'member'>} obj.acceptedRoles - accepted workspace roles
 * @param {String[]} obj.requiredPermissions - required permissions as part of the endpoint
 */
const validateClientForSecret = async ({
    authData,
    secretId,
    acceptedRoles,
    requiredPermissions
}: {
    authData: {
		authMode: string;
		authPayload: IUser | IServiceAccount | IServiceTokenData;
	},
    secretId: Types.ObjectId;
    acceptedRoles: Array<'admin' | 'member'>;
    requiredPermissions: string[];
}) => {
    const secret = await Secret.findById(secretId);

    if (!secret) throw SecretNotFoundError({
        message: 'Failed to find secret'
    });

    if (authData.authMode === AUTH_MODE_JWT && authData.authPayload instanceof User) {
        await validateUserClientForSecret({
            user: authData.authPayload,
            secret,
            acceptedRoles,
            requiredPermissions
        });

        return secret;
    }

    if (authData.authMode === AUTH_MODE_SERVICE_ACCOUNT && authData.authPayload instanceof ServiceAccount) {
        await validateServiceAccountClientForWorkspace({
            serviceAccount: authData.authPayload,
            workspaceId: secret.workspace,
            environment: secret.environment,
            requiredPermissions
        });
        
        return secret;
    }

    if (authData.authMode === AUTH_MODE_SERVICE_TOKEN && authData.authPayload instanceof ServiceTokenData) {
        await validateServiceTokenDataClientForWorkspace({
            serviceTokenData: authData.authPayload,
            workspaceId: secret.workspace,
            environment: secret.environment
        });
    
        return secret;
    }
    
    if (authData.authMode === AUTH_MODE_API_KEY && authData.authPayload instanceof User) {
        await validateUserClientForSecret({
            user: authData.authPayload,
            secret,
            acceptedRoles,
            requiredPermissions
        });

        return secret;
    }
    
    throw UnauthorizedRequestError({
        message: 'Failed client authorization for secret'
    });
}

/**
 * Validate authenticated clients for secrets with ids [secretIds] based
 * on any known permissions.
 * @param {Object} obj
 * @param {Object} obj.authData - authenticated client details
 * @param {Types.ObjectId[]} obj.secretIds - id of workspace to validate against
 * @param {String} obj.environment - (optional) environment in workspace to validate against
 * @param {Array<'admin' | 'member'>} obj.acceptedRoles - accepted workspace roles
 * @param {String[]} obj.requiredPermissions - required permissions as part of the endpoint
 */
const validateClientForSecrets = async ({
    authData,
    secretIds,
    requiredPermissions
}: {
    authData: {
		authMode: string;
		authPayload: IUser | IServiceAccount | IServiceTokenData;
	},
    secretIds: Types.ObjectId[];
    requiredPermissions: string[];
}) => {

    let secrets: ISecret[] = [];
    
    secrets = await Secret.find({
        _id: {
            $in: secretIds
        }
    });

    if (secrets.length != secretIds.length) {
        throw BadRequestError({ message: 'Failed to validate non-existent secrets' })
    }

    if (authData.authMode === AUTH_MODE_JWT && authData.authPayload instanceof User) {
        await validateUserClientForSecrets({
            user: authData.authPayload,
            secrets,
            requiredPermissions
        });
        
        return secrets;
    }
    
    if (authData.authMode === AUTH_MODE_SERVICE_ACCOUNT && authData.authPayload instanceof ServiceAccount) {
        await validateServiceAccountClientForSecrets({
            serviceAccount: authData.authPayload,
            secrets,
            requiredPermissions
        });
        
        return secrets;
    }
        
    if (authData.authMode === AUTH_MODE_SERVICE_TOKEN && authData.authPayload instanceof ServiceTokenData) {
        await validateServiceTokenDataClientForSecrets({
            serviceTokenData: authData.authPayload,
            secrets,
            requiredPermissions
        });
        
        return secrets;
    }

    if (authData.authMode === AUTH_MODE_API_KEY && authData.authPayload instanceof User) {
        await validateUserClientForSecrets({
            user: authData.authPayload,
            secrets,
            requiredPermissions
        });
        
        return secrets;
    }

    throw UnauthorizedRequestError({
        message: 'Failed client authorization for secrets resource'
    });
}

/**
 * Create and return blind index for secret with
 * name [name] part of workspace with id [workspaceId]
 * @param {Object} obj
 * @param {Object} obj.secretName - name of secret to generate blind index for
 * @param {Object} obj.workspaceId - id of workspace that secret belongs to
 */
const createSecretBlindIndexHelper = async ({
    secretName,
    workspaceId
}: {
    secretName: string;
    workspaceId: Types.ObjectId;
}) => {

    // check if workspace blind index data exists
    // const secretBlindIndexData = await SecretBlindIndexData.findOne({
    //     workspace: workspaceId
    // });
    
    // if (!secretBlindIndexData) {
    //     // case: workspace blind index data has not been enabled
    // }
    
    // TODO: randomBytes should come from the decrypted secretBlindIndexData
    const randomBytes = crypto.randomBytes(16);

    const secretBlindIndex = (await argon2.hash(secretName, {
        type: argon2.argon2id,
        salt: randomBytes,
        saltLength: 16, // default 16 bytes
        memoryCost: 65536, // default pool of 64 MiB per thread.
        hashLength: 32,
        parallelism: 1,
        raw: true
    })).toString('base64');

    return secretBlindIndex;
}

/**
 * Return the blind index for the secret with
 * name [name] part of workspace with id [workspaceId]
 * @param {Object} obj
 * @param {Object} obj.secretName - name of secret to generate blind index for
 * @param {Object} obj.workspaceId - id of workspace that secret belongs to
 */
const getSecretBlindIndexHelper = async ({
    secretName,
    workspaceId
}: {
    secretName: string;
    workspaceId: Types.ObjectId;
}) => {

    // check if workspace blind index data exists
    const secretBlindIndexData = await SecretBlindIndexData.findOne({
        workspace: workspaceId
    });
    
    if (!secretBlindIndexData) {
        // case: workspace blind index data has not been enabled
    }
}

export {
    validateClientForSecret,
    validateClientForSecrets,
    createSecretBlindIndexHelper,
    getSecretBlindIndexHelper
}