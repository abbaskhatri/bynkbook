export {};

declare global {
  const $app: {
    stage: string;
  };

  const $config: (input: {
    app(input: { stage?: string }): unknown;
    run(): unknown;
  }) => unknown;

  const sst: {
    aws: {
      ApiGatewayV2: new (
        name: string,
        args?: unknown,
      ) => {
        url: string;
        addAuthorizer(args: unknown): { id: string };
        route(route: string, handler: unknown, args?: unknown): unknown;
      };
      Queue: new (
        name: string,
        args?: any,
      ) => {
        arn: any;
        name: any;
        url: any;
        subscribe(subscriber: any, args?: any, options?: any): unknown;
      };
    };
  };

  const aws: {
    cloudwatch: {
      MetricAlarm: new (name: string, args: Record<string, unknown>) => unknown;
    };
    sns: {
      Topic: new (
        name: string,
        args: Record<string, unknown>,
      ) => { arn: any };
    };
  };
}
