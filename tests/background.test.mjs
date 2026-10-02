/*
 * SPDX-FileCopyrightText: 2026 OukaroMF
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import test from "node:test";
import assert from "node:assert/strict";

const event = () => ({ handlers: [], addListener(fn) { this.handlers.push(fn); }, emit(...args) { for (const fn of this.handlers) fn(...args); } });
const url = "https://www.youtube.com/watch?v=abc";
const snapshot = (sequence, overrides = {}) => ({ version:1, type:"snapshot", sessionId:"page", sequence,
  site:"youtube", mediaId:"abc", title:"测试", url, captionsEnabled:true, text:"你好",status:"playing",position:1,duration:100,...overrides });

test("background forwards selected state, releases native host and resends after host crash", async () => {
  const nativePorts = [], titles = [], icons = [], badges = [];
  const assertIcon = state => assert.deepEqual(icons.at(-1), { 16:`icons/${state}-16.png`, 32:`icons/${state}-32.png` });
  const chrome = {
    runtime: { onConnect:event(), lastError:null, connectNative: host => {
      assert.equal(host,"com.oukaromf.lyricsync");
      const port = { onMessage:event(), onDisconnect:event(), messages:[], postMessage(message) {this.messages.push(message);}, disconnect() {this.disconnected=true;this.onDisconnect.emit();} };
      nativePorts.push(port); return port;
    } },
    tabs:{onRemoved:event()}, alarms:{onAlarm:event(),create(){},clear(){}},
    action:{onClicked:event(),setTitle:value=>titles.push(value.title),setIcon:value=>icons.push(value.path),setBadgeText:value=>badges.push(value.text)},
  };
  globalThis.chrome = chrome;
  await import("../extension/background.mjs");
  assertIcon("waiting");
  const page = {name:"cctracker-page",sender:{tab:{id:1},frameId:0,url},onMessage:event(),onDisconnect:event(),postMessage(){},disconnect(){this.onDisconnect.emit();}};
  chrome.runtime.onConnect.emit(page);
  page.onMessage.emit(snapshot(1,{translation:"hello",untrustedExtra:"never forward"}));
  assert.equal(nativePorts.length,1);
  assert.equal(nativePorts[0].messages[0].text,"你好");
  assert.equal(nativePorts[0].messages[0].translation,"hello");
  assert.equal("untrustedExtra" in nativePorts[0].messages[0],false);
  nativePorts[0].onMessage.emit({type:"ack"});
  assert.match(titles.at(-1),/已连接/);
  assertIcon("connected");
  nativePorts[0].onMessage.emit({type:"error",error:"Invalid native message"});
  assert.match(titles.at(-1),/连接失败\nInvalid native message/);
  assertIcon("failed");
  nativePorts[0].onMessage.emit({type:"ack"});
  page.onMessage.emit(snapshot(2,{text:"",status:"paused"}));
  assert.equal(nativePorts[0].messages.at(-1).text,"");
  nativePorts[0].onDisconnect.emit();
  assert.match(titles.at(-1),/连接失败/);
  assertIcon("failed");
  chrome.runtime.lastError={message:"Specified native messaging host not found."};
  chrome.action.onClicked.emit();
  nativePorts[1].onDisconnect.emit();
  assert.match(titles.at(-1),/LyricSync 未注册\nSpecified native messaging host not found\./);
  assertIcon("unregistered");
  chrome.runtime.lastError=null;
  chrome.action.onClicked.emit();
  assert.equal(nativePorts.length,3);
  assert.equal(nativePorts[2].messages.at(-1).status,"paused");
  page.onMessage.emit({version:1,type:"clear",sessionId:"page",sequence:3});
  assert.equal(nativePorts[2].messages.at(-1).type,"clear");
  assert.equal(nativePorts[2].disconnected,true);
  assert.match(titles.at(-1),/等待字幕/);
  assertIcon("waiting");
  delete chrome.runtime.connectNative;
  page.onMessage.emit(snapshot(4));
  assert.match(titles.at(-1),/浏览器不支持本机连接\nchrome.runtime.connectNative 不可用/);
  assertIcon("unsupported");
  page.onMessage.emit({version:1,type:"clear",sessionId:"page",sequence:5});
  assertIcon("waiting");
  assert.equal(badges.every(text=>text === ""),true,"status marks must not be covered by legacy badges");
  delete globalThis.chrome;
});
