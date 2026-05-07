import { createUserLoader } from './user.loader.js';
import { createProductLoader } from './product.loader.js';
import { createCategoryLoader, createCategoryChildrenLoader } from './category.loader.js';
import { createReviewSummaryLoader, createProductReviewsLoader } from './review.loader.js';

export interface DataLoaders {
  user: ReturnType<typeof createUserLoader>;
  product: ReturnType<typeof createProductLoader>;
  category: ReturnType<typeof createCategoryLoader>;
  categoryChildren: ReturnType<typeof createCategoryChildrenLoader>;
  reviewSummary: ReturnType<typeof createReviewSummaryLoader>;
  productReviews: ReturnType<typeof createProductReviewsLoader>;
}

// Create fresh DataLoaders per request (DataLoader caches within a request lifecycle)
export function createDataLoaders(): DataLoaders {
  return {
    user: createUserLoader(),
    product: createProductLoader(),
    category: createCategoryLoader(),
    categoryChildren: createCategoryChildrenLoader(),
    reviewSummary: createReviewSummaryLoader(),
    productReviews: createProductReviewsLoader(),
  };
}

export {
  createUserLoader,
  createProductLoader,
  createCategoryLoader,
  createCategoryChildrenLoader,
  createReviewSummaryLoader,
  createProductReviewsLoader,
};
