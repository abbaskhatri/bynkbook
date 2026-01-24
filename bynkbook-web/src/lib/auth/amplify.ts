import { Amplify } from "aws-amplify";

export function configureAmplify() {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
        userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_APP_CLIENT_ID!,
        // Stage 1: Hosted UI OAuth (Google)
        loginWith: {
          oauth: {
            domain: process.env.NEXT_PUBLIC_COGNITO_HOSTED_UI_DOMAIN!,
            scopes: ["openid", "email", "profile"],
            redirectSignIn: [process.env.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN!],
            redirectSignOut: [process.env.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT!],
            responseType: "code",
          },
        },
      },
    },
  });
}
