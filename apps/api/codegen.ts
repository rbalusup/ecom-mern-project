import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: './src/graphql/schema/**/*.graphql',
  generates: {
    './src/generated/graphql.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        useIndexSignature: true,
        contextType: '../graphql/context#GraphQLContext',
        scalars: {
          DateTime: 'Date',
          Decimal: 'number',
          JSON: 'Record<string, unknown>',
        },
        mappers: {
          User: '@ecom/db#IUserDocument',
          Product: '@ecom/db#IProductDocument',
          Order: '@ecom/db#IOrderDocument',
          Category: '@ecom/db#ICategoryDocument',
          Review: '@ecom/db#IReviewDocument',
          Cart: '@ecom/db#ICartDocument',
          Coupon: '@ecom/db#ICouponDocument',
        },
      },
    },
  },
};

export default config;
