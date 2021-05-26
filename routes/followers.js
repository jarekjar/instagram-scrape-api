var express = require("express");
var router = express.Router();
const puppeteer = require("puppeteer");

//global variables to track progress/data
//TODO: bind these to a session/cookie so that more than one scraper can run at a time
let currentLength = 0;
let failed = false;
let finished = false;
let followerData = [];
let totalFollowers = 0;
let loading = false;

//clear global var 
const clearData = () => {
  currentLength = 0;
  failed = false;
  finished = false;
  followerData = [];
  totalFollowers = 0;
  loading = false;
}

/* GET followers main route /followers */
router.get("/", async (req, res, next) => {

  //it a scrape is in progress return a 500
  if(currentLength !== 0 && !failed) {
    res.status(500).send("Scraping in progress.");
    return;
  }

  //if last scrape failed, clear the data and continue
  if(currentLength !== 0 && failed){
    clearData();
  }

  //destructure and assign the query parameters
  const { username, password, profile } = req.query;

  //validate the query paramters, return error if failed
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

  //route main try
  try {
    const browser = await puppeteer.launch({ headless: false });

    const page = await browser.newPage();

    await page.goto("https://www.instagram.com");


    //this is the main event listener, that checks for "query_hash" in the api calls 
    //while scrolling and collects and appends the data to the global variable
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
            responseData.data &&
            responseData.data.user &&
            responseData.data.user.edge_followed_by
          ) {
            //append new data with old data
            followerData = [...followerData, ...responseData.data.user.edge_followed_by.edges];
            console.log(followerData.length);
            currentLength = followerData.length;
            //tell the scraper to scroll again
            scroll();
          }
        }

        //this one checks for a failed login call, and return invalid IG message
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


    //find the login elements and input the user details to log in
    let userInput = await page.waitForSelector('input[name="username"]');
    let passwordInput = await page.waitForSelector('input[name="password"]');
    let logIn = await page.waitForSelector('button[type="submit"]');
    await userInput.type(username);
    await passwordInput.type(password);
    await logIn.click();
    await page.waitForSelector('img[data-testid="user-avatar"]');
    await page.goto(`https://www.instagram.com/${profile}`);

    //find the followers button
    let followersButton = await page.waitForSelector(
      `a[href="/${profile}/followers/"]`
    );

    //find and set the followers count
    totalFollowers = await page.evaluate((profile) => {
      return parseInt(document.querySelector(`a[href="/${profile}/followers/"] > span`).textContent.replace(/,/g, ''), 10)
    }, profile);


    //here is where you can set a hard limit for the scraper
    totalFollowers = 300;

    //return status OK with current progres, and begin the scraping
    //client is expected to call /followers/status to see the current status
    res.status(200).send({ inProgress: true, progress: currentLength, totalFollowers: totalFollowers });

    
    await followersButton.click();

    await page.waitForSelector("div[role='dialog'] > div > div:nth-child(2)");

    //asychronous scroll call
    //this tells the followers div to keep scrolling 
    //and is called every time new data comes in
    const scroll = async () => {
      try{
        page.evaluate(() => document.querySelector("div[role='dialog'] > div > div:nth-child(2)").scrollTop += 1200);
        if(followerData.length >= totalFollowers){
          finished = true;
          loading = false;
          await browser.close();
          return;
        }
      }
     catch(err) {
       console.log(err);
       failed = true;
     }
    };

    //call the defined scroll call
    await scroll().catch(err => {
      failed = true;
      console.log(err);
      browser.close();
      return;
    });

  } catch (err) {
    console.log(err);
    res.status(500).send("Scraper could not connect.");
    failed = true;
    return;
  }
});

/* GET status. */
router.get('/status', function(req, res, next) {
  //if the job has finished, return data to the client
  if(finished){
    res.status(200).send(followerData);
    clearData();
  }
  //if the job failed, return error to the client
  else if(failed){
    res.status(500).send("Scraper has failed.");
    clearData();
  }
  //return current scraper job status
  else res.status(202).send({ progress: currentLength, totalFollowers: totalFollowers });
});

module.exports = router;
