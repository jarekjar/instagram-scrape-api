var express = require("express");
var router = express.Router();
const puppeteer = require("puppeteer");

let currentLength = 0;
let failed = false;
let finished = false;
let followerData = [];
let totalFollowers = 0;
let loading = false;

const clearData = () => {
  currentLength = 0;
  failed = false;
  finished = false;
  followerData = [];
  totalFollowers = 0;
  loading = false;
}

/* GET followers */
router.get("/", async (req, res, next) => {

  if(currentLength !== 0 && !failed) {
    res.status(500).send("Scraping in progress.");
    return;
  }

  if(currentLength !== 0 && failed){
    clearData();
  }

  const username = req.query.username;
  const password = req.query.password;
  const profile = req.query.profile;

  if (!username || !password || !profile) {
    res
      .status(400)
      .send(
        `Missing required field(s): ${!username ? "Username " : ""} ${
          !password ? "Password " : ""
        } ${!profile ? "Profile " : ""}`
      );
    return;
  }

  try {
    const browser = await puppeteer.launch({ headless: false });

    const page = await browser.newPage();

    await page.goto("https://www.instagram.com");

    page.on("response", async (response) => {
      try{
        if (response.url().includes("query_hash")) {
          let responseData;
          try {
            responseData = await response.json();
          }
          catch(err){
            return;
          }
          if (
            responseData &&
            responseData.user &&
            responseData.data.user &&
            responseData.data.user.edge_followed_by
          ) {
            followerData = [...followerData, ...responseData.data.user.edge_followed_by.edges];
            loading = false;
            console.log(followerData.length);
            currentLength = followerData.length;
          }
        }
        if (response.url().includes("ajax")) {
          const responseData = await response.json();
          if (responseData.status === "fail") {
            res.status(400).send(responseData.message);
            failed = true;
            await browser.close();
            return;
          }
          if (responseData.authenticated === false) {
            res.status(400).send("Invalid instagram login.");
            failed = true;
            await browser.close();
            return;
          }
        }
      }
      catch(err) {
        console.log(err);
        failed = true;
        await browser.close();
        return;
      }
    });

    let userInput = await page.waitForSelector('input[name="username"]');
    let passwordInput = await page.waitForSelector('input[name="password"]');
    let logIn = await page.waitForSelector('button[type="submit"]');

    await userInput.type(username);
    await passwordInput.type(password);
    await logIn.click();
    await page.waitForSelector('img[data-testid="user-avatar"]');
    await page.goto(`https://www.instagram.com/${profile}`);

    let followersButton = await page.waitForSelector(
      `a[href="/${profile}/followers/"]`
    );

    totalFollowers = await page.evaluate((profile) => {
      return parseInt(document.querySelector(`a[href="/${profile}/followers/"] > span`).textContent.replace(/,/g, ''), 10)
    }, profile);

    res.status(200).send({ inProgress: true, progress: currentLength, totalFollowers: totalFollowers });

    await followersButton.click();

    await page.waitForSelector("div[role='dialog'] > div > div:nth-child(2)");

    const scroll = async () => {
      try{
        !loading && page.evaluate(() => document.querySelector("div[role='dialog'] > div > div:nth-child(2)").scrollTop += 1200);
        loading = true;
        await new Promise(resolve => setTimeout(resolve, 400));
        if(followerData.length >= 1000){
          finished = true;
          loading = false;
          await browser.close();
          return;
        }
        else {
          scroll();
        }
      }
     catch(err) {
       console.log(err);
       failed = true;
     }
    };

    await scroll();

  } catch (err) {
    console.log(err);
    res.status(500).send("Scraper could not connect.");
    failed = true;
    return;
  }
});

/* GET home page. */
router.get('/status', function(req, res, next) {
  if(finished){
    res.status(200).send(followerData);
    clearData();
  }
  else if(failed){
    res.status(500).send("Scraper has failed.");
    clearData();
  }
  else res.status(202).send({ progress: currentLength, totalFollowers: totalFollowers });
});

module.exports = router;
