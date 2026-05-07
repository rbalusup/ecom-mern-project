// MongoDB initialization script — creates dev database and user
db = db.getSiblingDB('ecom-genai-dev');

db.createUser({
  user: 'ecom_user',
  pwd: 'ecom_password',
  roles: [{ role: 'readWrite', db: 'ecom-genai-dev' }],
});

db.createCollection('users');
db.createCollection('products');
db.createCollection('orders');
db.createCollection('categories');

print('MongoDB initialized: ecom-genai-dev database and user created');
