// Connection
export { connectDB, disconnectDB, getConnection, isDBConnected } from './connection.js';

// Models
export { UserModel, type IUserDocument } from './models/User.model.js';
export { ProductModel, type IProductDocument } from './models/Product.model.js';
export { OrderModel, OrderEventModel, type IOrderDocument, type IOrderEventDocument } from './models/Order.model.js';
export { CartModel, type ICartDocument } from './models/Cart.model.js';
export { ReviewModel, type IReviewDocument } from './models/Review.model.js';
export { CouponModel, type ICouponDocument } from './models/Coupon.model.js';
export { CategoryModel, type ICategoryDocument } from './models/Category.model.js';
export { AIQueryModel, type IAIQueryDocument } from './models/AIQuery.model.js';

// Repositories
export { BaseRepository } from './repositories/base.repository.js';
export { ProductRepository } from './repositories/product.repository.js';
export { OrderRepository } from './repositories/order.repository.js';

// Aggregation pipelines
export {
  buildProductSearchPipeline,
  buildVectorSearchPipeline,
  buildProductWithCategoryPipeline,
  buildTopRatedProductsPipeline,
  buildFrequentlyBoughtTogetherPipeline,
} from './aggregations/product.pipeline.js';
export { buildOrderAnalyticsPipeline, buildCustomerOrderHistoryPipeline } from './aggregations/order.pipeline.js';
