// Lambda function to auto-confirm users on sign-up
// This bypasses email verification requirement

exports.handler = async (event) => {
    // Auto-confirm the user
    event.response.autoConfirmUser = true;
    
    // Also auto-verify email if present
    if (event.request.userAttributes.email) {
        event.response.autoVerifyEmail = true;
    }
    
    // Auto-verify phone if present
    if (event.request.userAttributes.phone_number) {
        event.response.autoVerifyPhone = true;
    }
    
    console.log('Auto-confirming user:', event.userName);
    
    return event;
};
