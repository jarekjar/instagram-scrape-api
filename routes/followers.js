var express = require("express");
var router = express.Router();
const puppeteer = require("puppeteer");

/* GET followers */
router.get("/", async (req, res, next) => {
  let followerData = [];

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
          const responseData = await response.json();
          if (
            responseData &&
            responseData.data.user &&
            responseData.data.user.edge_followed_by
          ) {
            followerData.concat(responseData.data.user.edge_followed_by.edges);
            //res.status(200).send(responseData.data.user.edge_followed_by.edges);
            //await browser.close();
            //return;
            console.log(followerData.length);
          }
        }
        if (response.url().includes("ajax")) {
          const responseData = await response.json();
          if (responseData.status === "fail") {
            res.status(400).send(responseData.message);
            await browser.close();
            return;
          }
          if (responseData.authenticated === false) {
            res.status(400).send("Invalid instagram login.");
            await browser.close();
            return;
          }
        }
      }
      catch(err) {
        //res.status(500).send("Error occured.");
        console.log(err);
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

    await followersButton.click();

    await page.waitForSelector("div[role='dialog'] > div > div:nth-child(2)");

    //const followersDiv = page.evaluate(() => document.querySelector("div[role='dialog'] > div > div:nth-child(2)"));

    const scroll = async () => {
      try{
        page.evaluate(() => document.querySelector("div[role='dialog'] > div > div:nth-child(2)").scrollTop += 1200);
        await new Promise(resolve => setTimeout(resolve, 400));
        scroll();
        if(followerData.length >= 200){
          res.status(200).send(followerData);
          await browser.close();
          return;
        }
        else {
          scroll();
        }
      }
     catch(err) {
       console.log(err);
     }
    };

    return await scroll();

  } catch (err) {
    console.log(err)
    res.status(500).send("Scraper could not connect.");
    return;
  }
});

module.exports = router;
