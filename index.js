/* eslint-disable no-console */
const {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  writeFile,
} = require("fs");
const { createServer } = require("http");

// ПЕРЕМЕННЫЕ: =========================================================================
// database
const DB_USER = process.env.DB_USER || "./db_user.json";
const DB_GOODS = process.env.DB_GOODS || "./db_goods.json";
// port
const PORT = process.env.PORT || 5000;
// routes
const URI_GOODS = "/api/goods";
const URI_USER = "/api/user";
const URI_CATEGORIES = "/api/categories";
const URI_TOTAL_PRICE = "/api/total";

// =====================================================================================


// ОШИБКА: =============================================================================
// error
class ApiError extends Error {
  constructor(statusCode, data) {
    super();
    this.statusCode = statusCode;
    this.data = data;
  }
}

// =====================================================================================


// ОБЩИЕ ФУНКЦИИ: ======================================================================
function drainJson(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      resolve(JSON.parse(data));
    });
  });
}

const pagination = (data, page, cnt = 10) => {
  const count = parseInt(cnt) || 10;
  const end = count * page;
  const start = page === 1 ? 0 : end - count;
  const totalCount = data.length;

  const pages = Math.ceil(data.length / count);

  return {
    goods: data.slice(start, end),
    page,
    pages,
    totalCount,
  };
};

function isImageBase64(data) {
  return /^data:image/.test(data);
}

function isImageURL(data) {
  return /^image\//.test(data);
}

function dataURLtoFile(base64, id) {
  if (!existsSync("./image")) {
    mkdirSync("./image");
  }
  const format = base64.split(";")[0].split("/")[1];
  const ext = format === "svg+xml" ? "svg" : format === "jpeg" ? "jpg" : format;
  const base64Image = base64.split(";base64,").pop();
  writeFile(
    `./image/${id}.${ext}`,
    base64Image,
    { encoding: "base64" },
    (err) => {
      if (err) console.log(err);
    }
  );
  return `image/${id}.${ext}`;
}

function makeGoodsFromData(data, id) {
  const errors = [];

  function asString(str) {
    return (str && String(str).trim()) || "";
  }

  function isNumber(num) {
    return !Number.isNaN(parseFloat(num)) && isFinite(num);
  }

  const goods = {
    title: asString(data.title),
    description: asString(data.description),
    price: data.price,
    discount: data.discount || 0,
    count: data.count,
    units: asString(data.units),
    image: data.image,
    category: data.category,
  };

  if (!goods.title)
    errors.push({ field: "title", message: "Не указано название товара" });
  if (!goods.description)
    errors.push({ field: "description", message: "Не указано описание" });
  if (!isNumber(goods.price))
    errors.push({ field: "price", message: "Не указана цена" });
  if (!isNumber(goods.count))
    errors.push({ field: "count", message: "Не указано кол-во" });
  if (!goods.units)
    errors.push({ field: "units", message: "Не указаны ед. измерения" });
  if (!goods.category)
    errors.push({ field: "category", message: "Не указана категория товара" });

  if (errors.length) throw new ApiError(422, { errors });

  if (isImageBase64(goods.image)) {
    const url = dataURLtoFile(goods.image, id);
    goods.image = url;
  } else if (!isImageURL(goods.image)) {
    goods.image = "image/notimage.jpg";
  }

  return goods;
}

function getCategoryList() {
  const goods = JSON.parse(readFileSync(DB_GOODS) || "[]");
  const category = [...new Set(goods.map((item) => item.category))];
  return category;
}

function getDiscountList() {
  const goods = JSON.parse(readFileSync(DB_GOODS) || "[]");
  return goods.filter((item) => item.discount);
}

function getGoodsList(params = {}) {
  const goods = JSON.parse(readFileSync(DB_GOODS) || "[]");
  
  if (params === "all" || params.size === 'all') {
    return goods;
  }

  let size = params.size || 10;
  let page = 1;
  if (params.search) {
    const search = params.search.trim().toLowerCase();
    return pagination(
      goods.filter((goods) =>
        [goods.title, goods.description].some((str) =>
          str.toLowerCase().includes(search)
        )
      ),
      page,
      size,
    );
  }

  if (params.page) {
    page = parseInt(params.page);
  }
  return pagination(goods, page, size);
}

function getGoodsCategorytList(category) {
  if (!category) return getGoodsList("all");
  const goods = JSON.parse(readFileSync(DB_GOODS) || "[]");
  if (!goods) throw new ApiError(404, { message: "Goods Not Found" });
  return goods.filter(
    (item) => decodeURI(item.category) === decodeURI(category)
  );
}

function createGoods(data) {
  const id =
    Math.random().toString().substring(2, 8) +
    Date.now().toString().substring(9);
  const newItem = makeGoodsFromData(data, id);
  newItem.id = id;
  writeFileSync(DB_GOODS, JSON.stringify([...getGoodsList("all"), newItem]), {
    encoding: "utf8",
  });
  return newItem;
}

function getGoods(itemId) {
  const goods = getGoodsList("all").find(({ id }) => id === itemId);
  if (!goods) throw new ApiError(404, { message: "Goods Not Found" });
  return goods;
}

function updateGoods(itemId, data) {
  const goods = getGoodsList("all");
  const itemIndex = goods.findIndex(({ id }) => id === itemId);
  if (itemIndex === -1) throw new ApiError(404, { message: "Goods Not Found" });
  Object.assign(
    goods[itemIndex],
    makeGoodsFromData({ ...goods[itemIndex], ...data }, itemId)
  );
  writeFileSync(DB_GOODS, JSON.stringify(goods), { encoding: "utf8" });
  return goods[itemIndex];
}

function deleteGoods(itemId) {
  const goods = getGoodsList("all");
  const itemIndex = goods.findIndex(({ id }) => id === itemId);
  if (itemIndex === -1) throw new ApiError(404, { message: "Goods Not Found" });
  goods.splice(itemIndex, 1);
  writeFileSync(DB_GOODS, JSON.stringify(goods), { encoding: "utf8" });
  return {};
}

function getTotalPrice() {
  const goods = getGoodsList("all");
  return goods.reduce((acc, item) => acc + item.count * item.price, 0);
}

// User functions
function getUser() {
  const user = JSON.parse(readFileSync(DB_USER) || "{}");
  if (!user) throw new ApiError(404, { message: "User Not Found" });
  return user;
}

function calculateUserCart(arr) {
  return arr.reduce((acc, item) => acc + (item.price * item.count), 0); 
}

function addProductToUserCart(data) {
  const user = getUser();
  let notAlreadyInCart = true;
  user.cart.forEach((product) => {
    if (product.id === data.id) {
      notAlreadyInCart = false;
      if (product.count !== product.maxCount) product.count = product.count + 1;
    }
  });
  if (notAlreadyInCart) user.cart.push(data);
  user.totalCartCost = calculateUserCart(user.cart);
  writeFileSync(DB_USER, JSON.stringify(user), { encoding: "utf8" });
}

function removeProductsFromUserCart(reqBody) {
  const { identifiers } = reqBody;
  const user = getUser();
  user.cart = user.cart.filter((item) => !(identifiers.includes(item.id)));
  user.totalCartCost = calculateUserCart(user.cart);
  writeFileSync(DB_USER, JSON.stringify(user), { encoding: "utf8" });
  return user;
}

function changeProductInUserCart(reqBody) {
  const { id, type } = reqBody;
  const user = getUser();
  user.cart.forEach((product) => {
    if (product.id === id && type === 'checkbox') {
      product.isCheckedForOrder = !product.isCheckedForOrder
    }
    if (product.id === id && type === 'increase' && product.count !== product.maxCount) {
      product.count = Number(product.count) + 1;
    }
    if (product.id === id && type === 'decrease' && product.count !== '1') {
      product.count = Number(product.count) - 1;
    }
    user.totalCartCost = calculateUserCart(user.cart);    
  });
  writeFileSync(DB_USER, JSON.stringify(user), { encoding: "utf8" });
  return user;
}

if (!existsSync(DB_GOODS)) writeFileSync(DB_GOODS, "[]", { encoding: "utf8" });

// =====================================================================================



// СЕРВЕР  =============================================================================

module.exports = createServer(async (req, res) => {
  if (req.url.substring(1, 6) === "image") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/jpeg");
    require("fs").readFile(`.${req.url}`, (err, image) => {
      res.end(image);
    });
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PATCH, DELETE, OPTIONS"
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.end();
    return;
  }

  // Обработка отсутствия URL
  if (
    !req.url ||
    (!req.url.startsWith(URI_GOODS) &&
     !req.url.startsWith(URI_USER) && 
     !req.url.startsWith(URI_CATEGORIES) &&
     !req.url.startsWith(URI_TOTAL_PRICE))
  ) {
    res.statusCode = 404;
    res.end(JSON.stringify({ message: "Not Found" }));
    return;
  }

  let data = null;

  // URI categories
  if (req.url.startsWith(URI_CATEGORIES)) {
    data = [URI_CATEGORIES];
  }
  // URI goods
  if (req.url.startsWith(URI_GOODS)) {
    data = req.url.substring(URI_GOODS.length).split("?");
  }
  // URI user
  if (req.url.startsWith(URI_USER)) {
    data = [URI_USER];
  }
  // URI total price
  if (req.url.startsWith(URI_TOTAL_PRICE)) {
    data = [URI_TOTAL_PRICE];
  }

  const [uri, query] = data;
  const queryParams = {};

  if (query) {
    for (const piece of query.split("&")) {
      const [key, value] = piece.split("=");
      queryParams[key] = value ? decodeURIComponent(value) : "";
    }
  }

  try {
    const body = await (async () => {

      // Categories
      if (uri === URI_CATEGORIES) {
        if (req.method === "GET") return getCategoryList();
      }
      // Total price
      if (uri === URI_TOTAL_PRICE) {
        if (req.method === "GET") return getTotalPrice();
      }
      // User
      if (uri === URI_USER) {
        if (req.method === "GET") return getUser();
        if (req.method === "POST") addProductToUserCart(await drainJson(req));
        if (req.method === "PATCH") return changeProductInUserCart(await drainJson(req));
        if (req.method === "DELETE") return removeProductsFromUserCart(await drainJson(req));
      }
      // Discount
      if (uri === "/discount") {
        return getDiscountList();
      }
       
      // Goods from category
      if (/^\/category\/*/.test(uri)) {
        return getGoodsCategorytList(uri.replace(/^\/category\//, ""));
      }

      if (uri === "" || uri === "/") {
        if (req.method === "GET") return getGoodsList(queryParams);
        if (req.method === "POST") {
          const createdItem = createGoods(await drainJson(req));
          res.statusCode = 201;
          res.setHeader("Access-Control-Expose-Headers", "Location");
          res.setHeader("Location", `${URI_GOODS}/${createdItem.id}`);
          return createdItem;
        }
      } else {
        const itemId = uri.substring(1);
        if (req.method === "GET") return getGoods(itemId);
        if (req.method === "PATCH")
          return updateGoods(itemId, await drainJson(req));
        if (req.method === "DELETE") return deleteGoods(itemId);
      }
      return null;
    })();
    res.end(JSON.stringify(body));
  } catch (err) {
    if (err instanceof ApiError) {
      res.writeHead(err.statusCode);
      res.end(JSON.stringify(err.data));
    } else {
      res.statusCode = 500;
      res.end(JSON.stringify({ message: "Server Error" }));
      console.error(err);
    }
  }
})
  .on("listening", () => {
    if (process.env.NODE_ENV !== "test") {
      console.log(
        `Сервер CMS запущен. Вы можете использовать его по адресу http://localhost:${PORT}`
      );
      console.log("Нажмите CTRL+C, чтобы остановить сервер");
      console.log("Доступные методы:");
      console.log(
        `GET ${URI_GOODS} - получить список товаров, в query параметр search можно передать поисковый запрос`
      );
      console.log(
        `POST ${URI_GOODS} - создать товар, в теле запроса нужно передать объект {title: string, description: string, price: number, discount?: number, count: number, units: string, image?: string, category: string }`
      );
      console.log(`GET ${URI_GOODS}/{id} - получить товар по его ID`);
      console.log(
        `PATCH ${URI_GOODS}/{id} - изменить товар с ID, в теле запроса нужно передать объект {title: string, description: string, price: number, discount?: number, count: number, units: string, image?: string, category: string }`
      );
      console.log(`DELETE ${URI_GOODS}/{id} - удалить товар по ID`);
      console.log(
        `GET ${URI_GOODS}/discount - получить список дисконтных товаров`
      );
      console.log(
        `GET ${URI_GOODS}/category/{category} - получить список товаров по категории`
      );
      console.log(`GET ${URI_CATEGORIES} - получить список категорий`);
      console.log(
        `GET ${URI_TOTAL_PRICE} - получить общую стоимость всех товаров`
      );
    }
  })
  .listen(PORT);
