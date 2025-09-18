import express from 'express'
import bodyParser from 'body-parser';
import path from 'path'
import { dirname } from 'path';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

import { fileURLToPath } from 'url';
import pg from 'pg';
import multer from 'multer';
// to download database 
import { Parser } from 'json2csv';

// to download in excel format
import ExcelJS from 'exceljs';
import session from 'express-session';
import dotenv from 'dotenv';
import csv from 'csv-parser';
import xlsx from 'xlsx';
dotenv.config()
  

import { name } from 'ejs';
import bcrypt from 'bcrypt'
import rateLimit from 'express-rate-limit';
import {promises as fs} from 'fs'



// const loginLimiter = rateLimit({
//   windowMs: 3* 60 * 1000, 
//   max: 3,
//   message: 'Too many login attempts, please try again later.'
// });


const transporter =nodemailer.createTransport({
  service: 'gmail',
  auth:{
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// connect database
const db= new pg.Client(
  {
    user:process.env.DB_USER,
    localhost: process.env.DB_HOST,
    database: "ndc ",
    password: process.env.DB_PASSWORD,
    port: process.env.BD_PORT,
  }
)

const __dirname =dirname(fileURLToPath(import.meta.url));
const app =express();
const port = 3300;
var validUSer =false;

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({extended: true}));
import methodOverride from 'method-override';
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, "public")));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(session({
  secret:process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: {secure:false}
}));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);  
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });


db.connect((err)=>{
  if(err){
    console.log(`failed to connect to database`,err)
  }else{
    console.log(`connected to database successfully`)
  }
});


async function logActivity(user, action, details = '') {
  try {
    await db.query(
      `INSERT INTO activity_logs (user_id, user_email, action, details)
       VALUES ($1, $2, $3, $4)`,
      [user?.id || 'guest', user?.email || 'unknown', action, details]
    );
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}


// const passcode =async (req,res,next)=>{
//   const {id,password,email} =req.body;


// try {
//     const results =await db.query(`SELECT id, user_name, email, image, password,role FROM users WHERE email = $1`,[email]);
    
//     const users =results.rows[0];
    
//     if(users){
//       if(password === users.password){
//         req.session.user =users;
//         req.users =users;
//         validUSer =true;
//         await logActivity(users, 'Login', 'User logged in successfully');
//       }else{
//         validUSer =false
//       }
//     }
//     else{
//       validUSer =false;
//       await logActivity(null, 'Failed Login', `Attempted login for ${email}`);
//     }
//     if(!validUSer){
//       return res.redirect('/?error=Login failed, please check your credentials');
//     }
//     next();
// } catch (err) {
//   console.error(`Error checking credentials`)
//   res.status(500).send('Error Checking credentials')
// }
// };


const passcode = async (req, res, next) => {
  const { id, password, email } = req.body;
  try {
    const results = await db.query(`SELECT id, user_name, email, image, password, role FROM users WHERE email = $1`, [email]);
    const user = results.rows[0];
    if (user && await bcrypt.compare(password, user.password)) {
      req.session.user = {
        id: user.id,
        username: user.user_name, // Use username to match templates
        email: user.email,
        image: user.image,
        role: user.role
      };
      await logActivity(req.session.user, 'Login', 'User logged in successfully');
      next();
    } else {
      await logActivity(null, 'Failed Login', `Attempted login for ${email}`);
      res.redirect('/?error=Invalid credentials');
    }
  } catch (err) {
    console.error('Error checking credentials:', err);
    res.status(500).send('Error checking credentials');
  }
};


function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/');
}



const requireAdmin =(req, res, next)=> {
  if (req.session.user && req.session.user.role === 'admin') {
    return next();
  } else {
    return res.status(403).send('Access denied: ADMINS ONLY.');
  }
}



app.get('/logout', async (req,res)=>{
  if (req.session.user) await logActivity(req.session.user, 'Logout', 'User logged out');
  req.session.destroy(err =>{
    if(err){
      return res.status(500).send('Could not log out')
    }
    
  })
  res.redirect('/?success=You have been logged out successfully');
  })




  app.get('/home', isAuthenticated, async (req, res) => {
  try {
    const nssResults = await db.query('SELECT COUNT(*) AS count FROM users WHERE role = $1', ['nss']);
    const staffResults = await db.query('SELECT COUNT(*) AS count FROM users WHERE role = $1', ['user']);
    const dataResults = await db.query('SELECT * FROM data ORDER BY id ASC');

    const totalCount = parseInt(nssResults.rows[0].count) + parseInt(staffResults.rows[0].count);
    const metrics = {
      nssPersonnel: nssResults.rows[0].count,
      staffMembers: staffResults.rows[0].count,
      totalMembers: totalCount,
    };

    const sanitizedData = dataResults.rows.map(row => ({
      id: row.id || null,
      day: row.day || null,
      mm: row.mm || null,
      year: row.year || null,
      minute: row.minute || null,
      second: row.second || null,
      hr: row.hr || null,
      latitude: row.latitude || null,
      longitude: row.longitude || null,
      h: row.h || null,
      mb: row.mb || null,
      ml: row.ml || null,
      az: row.az || null,
      location: row.location === 'GH' ? 'Ghana' : row.location || null,
      nearest_location: row.nearest_location || null,
    }));

    await logActivity(req.session.user, 'Access Home Dashboard', 'User accessed home dashboard');

    res.render('dashboard.ejs', {
      metrics,
      users: req.session.user,
      data: sanitizedData,
    });
  } catch (err) {
    console.error('Error fetching data for home dashboard:', err);
    res.status(500).send('Error loading home dashboard');
  }
});
// app.get('/', (req, res) => {
//   const success = req.query.success || null;
//   const error = req.query.error || null;

//   res.render('home', { success, error });
// });



app.get('/user',isAuthenticated ,(req,res)=>{
if(req.session.user?.role !== 'admin'){
  return res.status(403).send('Access denied')
}
  res.render('user.ejs',
    { users: req.session.user})
})


app.get('/delete-users', isAuthenticated, requireAdmin, async (req, res) => {
  try {
    const results = await db.query('SELECT id, user_name, email, role FROM users ORDER BY id');
    await logActivity(req.session.user, 'View Delete Users', 'Admin accessed delete users page');
    res.render('delete-users.ejs', {
      user: req.session.user,
      users: results.rows,
      error: req.query.error,
      success: req.query.success
    });
  } catch (err) {
    console.error('Error fetching users for deletion:', err);
    res.redirect('/delete-users?error=Error fetching users');
  }
});

// New DELETE route for users

app.delete('/delete-users/:id', isAuthenticated, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    // Prevent admin from deleting themselves

    if (parseInt(id) === parseInt(req.session.user.id)) {
      return res.redirect('/delete-users?error=Cannot delete your own account');
    }

    const result = await db.query('SELECT user_name, email FROM users WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.redirect('/delete-users?error=User not found');
    }

    const deletedUser = result.rows[0];
    await db.query('DELETE FROM users WHERE id = $1', [id]);
    await logActivity(req.session.user, 'Delete User', `Deleted user ${deletedUser.email} (ID: ${id})`);

    res.redirect('/delete-users?success=User deleted successfully');
  } catch (err) {
    console.error('Error deleting user:', err);
    res.redirect('/delete-users?error=Error deleting user');
  }
});




app.get('/add', isAuthenticated, (req,res)=>{
  res.render('add.ejs',
    {users: req.session.user})
});

 

app.get('/activities', isAuthenticated, requireAdmin, async (req, res) => {

  try {
    const logs = await db.query('SELECT * FROM activity_logs ORDER BY timestamp DESC');

    res.render('activities.ejs',
       { 
          logs: logs.rows,
          users: req.session.user
       });


  } catch (err) {
    console.error('Error fetching activity logs:', err);
    res.status(500).send('Error fetching logs');
  }
});

 

// map route 
app.get('/map',isAuthenticated ,async (req,res)=>{
  try{
      const results = await db.query(`SELECT * FROM data`)
    await logActivity (req.session.user,'view Map','User accesed interactive map page')
    res.render(
      'map',{
        users: req.session.user,
        data: results.rows
      });
  } catch (err){
    console.error('Error Fetching data for map:', err)
    await logActivity( req.session.user, 'Map View Error','Error Fetching data for map')
  }
})



// password authentication
app.get('/submit',isAuthenticated, (req,res)=>{
  res.render('dashbaord.ejs')
})

app.post('/submit',passcode, isAuthenticated,
   async (req,res)=>{
  try {
    const nssResults = await db.query('SELECT COUNT(*) AS count FROM users WHERE role = $1',['nss']);
    const staffResults = await db.query('SELECT COUNT(*) AS count FROM users WHERE role =$1',['user'] );

     const dataResults = await db.query('SELECT * FROM data ORDER BY id ASC');
    console.log('Data fetched for dashboard:', dataResults.rows);

    const totalCount = parseInt(nssResults.rows[0].count) + parseInt(staffResults.rows[0].count);
    const usersResults = await db.query('SELECT id, email, image, user_name FROM users ');
    const metrics = {
      nssPersonnel: nssResults.rows[0].count,
      staffMembers: staffResults.rows[0].count,
      totalMembers: totalCount,
    };


    const sanitizedData = dataResults.rows.map(row => ({
      id: row.id || null,
      day: row.day || null,
      mm: row.mm || null,
      year: row.year || null,
      minute: row.minute || null,
      second: row.second || null,
      hr: row.hr || null,
      latitude: row.latitude || null,
      longitude: row.longitude || null,
      h: row.h || null,
      mb: row.mb || null,
      ml: row.ml || null,
      az: row.az || null,
      location: row.location === 'GH' ? 'Ghana' : row.location || null,
      nearest_location: row.nearest_location || null
    }));

    await logActivity(req.session.user, 'View Dashboard', 'User accessed dashboard');

    res.render('dashboard.ejs',
      { metrics,
        users: req.session.user,
        data: sanitizedData
    })

  } catch (err) {
    console.error('Error fetching data for dashboard:', err);
    res.status(500).send('Error loading dashboard');
  }});


app.post('/add',upload.single('photo'), isAuthenticated, async (req,res)=>{

  const {password,email,name,role} =req.body;
  const image = req.file ? `/uploads/${req.file.filename}`: null;
  const hashedPassword =await bcrypt.hash(password,10)

  try {
    await db.query(`INSERT INTO users (password,email,image,user_name,role)
       VALUES
       ($1,$2,$3,$4,$5)
       RETURNING id`
       ,[password,email,image,name,role]);

       await logActivity(req.session.user, 'Create User', `User ${email} added`);

       res.redirect('/?success=User added successfully');
      } catch (err) {
    console.error('Error inserting data',err);
    res.status(500).send('error saving data');
  }
})

 

app.post('/events', async (req, res) => {
  const { 
    day,
    month,
    year,
    minute,
    second,
    hour,
    latitude,
    longitude,
    H,
    Mb,
    Ml,
    Az,
    location,
    nearest_location
  } = req.body;

  if (
    !day || !month || !year || !minute || !second || !hour ||
    !latitude || !longitude || !H || !Mb ||
    !Ml || !Az || !location || !nearest_location
  ) {
    return res.status(400).send('All fields must be filled out.');
  }

  try {
      const result = await db.query(`
      INSERT INTO data (
        day, mm, year, minute, second, hr, latitude, longitude, h, mb, ml, az, location, nearest_location
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,$13,$14
      )
      ON CONFLICT (id) DO UPDATE SET
        day = EXCLUDED.day,
        mm = EXCLUDED.mm,
        year = EXCLUDED.year,
        minute = EXCLUDED.minute,
        second = EXCLUDED.second,
        hr = EXCLUDED.hr,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        h = EXCLUDED.h,
        mb = EXCLUDED.mb,
        ml = EXCLUDED.ml,
        az = EXCLUDED.az,
        location = EXCLUDED.location,
        nearest_location = EXCLUDED.nearest_location
    RETURNING id`, [
      day,
      month,
      year,
      minute,
      second,
      hour,
      latitude,
      longitude,
      H,
      Mb,
      Ml,
      Az,
      location,
      nearest_location
    ]);

    const newEventId = result.rows[0].id;


    await logActivity(req.session.user, 'Add/Update Event', `Event ${newEventId} added or updated`);


    res.redirect('/add');
  } catch (err) {
    console.error('Error inserting or updating event data:', err);
    res.status(500).send('Server error saving event data.');
  }
});



app.get('/manage-data',isAuthenticated, async (req,res)=>{
  try {
    const results =await db.query(`SELECT * FROM data ORDER BY id ASC`);
    console.log('Fetched events:', results.rows);
    res.render('manage-data.ejs',
      {
      data:results.rows,
      users: req.session.user,
      query: '',
      column: ''
     })
  } catch (err) {
    console.error('Error Fetching data',err);
    res.status(500).send(`error in your client`);
  }
})

 

app.get('/search', async (req, res) => {
  const { query, column } = req.query;

  // If no query is provided, return all data
  if (!query) {
    try {
      const results = await db.query('SELECT * FROM data');
      return res.render('manage-data.ejs', {
         data: results.rows,
         users: req.session.user,
         query: '',
         column: '' 
        });
    } catch (err) {
      console.error('Error fetching all data:', err);
      return res.status(500).send('Error fetching data');
    }
  }

  // Define valid columns to prevent postgrSQL injection

  const validColumns = [
    'id', 'day', 'mm','year', 'minute', 'second', 'hr', 'latitude', 'longitude',
    'h', 'mb', 'ml', 'az', 'location', 'nearest_location'
  ];

  // Default to searching all columns if no specific column is provided

  let sqlQuery = '';
  let queryParams = [];

  if (column && validColumns.includes(column)) {
    // Search in a specific column
    sqlQuery = `SELECT * FROM data WHERE ${column}::TEXT ILIKE '%'|| $1 || '%'`;
    queryParams = [query];
  } else {
    // Search across all columns
    sqlQuery = `
      SELECT * FROM data WHERE
        id::TEXT = $1 OR
        day::TEXT = $1 OR
        mm = $1 OR
        year::TEXT = $1 OR
        minute::TEXT = $1 OR
        second::TEXT = $1 OR
        hr::TEXT = $1 OR
        latitude::TEXT = $1 OR
        longitude::TEXT = $1 OR
        h::TEXT = $1 OR
        mb::text ILIKE $1 || '%' OR
        ml::TEXT = $1 OR
        az::TEXT = $1 OR
        location::text ILIKE $1|| '%' OR
        nearest_location::text ILIKE || '%' = $1
    `;
    queryParams = [query];
  }

  try {
    const results = await db.query(sqlQuery, queryParams);
    await logActivity(req.session.user, 'Search Data', `Searched for value "${query}" in ${column || 'all columns'}`);
    res.render('manage-data.ejs', {
      data: results.rows,
      users: req.session.user,
      query,
      column
    });
  } catch (err) {
    console.error('Error executing search query:', err);
    res.status(500).send('Error searching data');
  }
});


app.get('/dashboard',isAuthenticated, async (req, res) => {
  try {
    const userResults = await db.query('SELECT COUNT(*) AS count FROM users WHERE email = $1', ['active']);
    const nssResults = await db.query('SELECT COUNT(*) AS count FROM users WHERE role =$1 ', ['nss']);
    const staffResults = await db.query('SELECT COUNT(*) AS count FROM users WHERE role = $1 ', [ 'user'] );
    const totalResults = await db.query('SELECT COUNT(*) AS count FROM users');

    const dataResults = await db.query('SELECT * FROM data ORDER BY id ASC');
    console.log('Data fetched for dashboard:', dataResults.rows);

    const metrics = {
      activeMembers: userResults.rows[0].count,
      nssPersonnel: nssResults.rows[0].count,
      staffMembers: staffResults.rows[0].count,
      totalMembers: totalResults.rows[0].count,

      
    };


    const sanitizedData = dataResults.rows.map(row => ({
      id: row.id,
      day: row.day || null,
      mm: row.mm || null,
      year: row.year || null,
      minute: row.minute || null,
      second: row.second || null,
      hr: row.hr || null,
      latitude: row.latitude || null,
      longitude: row.longitude || null,
      h: row.h || null,
      mb: row.mb || null,
      ml: row.ml || null,
      az: row.az || null,
      location: row.location || null,
      nearest_location: row.nearest_location || null
    }));

    await logActivity(req.session.user, 'Access Dashboard', 'User accessed dashboard');


    const usersResults = await db.query('SELECT id, email, image,user_name FROM users');


    res.render('dashboard.ejs',
       { metrics,
         users:req.session.user,
         data: sanitizedData 
     });
  } catch (err) {
    console.error('Error fetching data for dashboard:', err);
    res.status(500).send('Error loading dashboard');
  }
});


 

app.delete('/data/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM data WHERE id = $1', [id]);

    await logActivity(req.session.user, 'Delete Event', `Event ${id} deleted`);

    res.redirect('/manage-data?success=Event deleted successfully');
  } catch (err) {
    console.error('Error deleting data:', err);
    res.status(500).send('Error deleting data');
  }
});

// download database into csv format 

app.get('/download', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM data');
    const rows = result.rows;

    if (rows.length === 0) {
      return res.status(404).send('No data available to download.');
    }

    const fields = Object.keys(rows[0]); // CSV headers from DB columns
    const opts = { fields };
    const parser = new Parser(opts);
    const csv = parser.parse(rows);

    await logActivity(req.session.user, 'Download CSV', 'User downloaded data in CSV');


    res.header('Content-Type', 'text/csv');
    res.attachment('data_export.csv');
    return res.send(csv);
  } catch (err) {
    console.error('Error exporting data:', err);
    res.status(500).send('Error exporting data');
  }
});

// download database in excel format 
app.get('/download-excel', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM data');
    const rows = result.rows;

    if (rows.length === 0) {
      return res.status(404).send('No data to export.');
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Event Data');

    // Add headers from the keys of the first row
    worksheet.columns = Object.keys(rows[0]).map(key => ({
      header: key.toUpperCase(),
      key: key,
      width: 20
    }));

    // Add rows
    rows.forEach(row => {
      worksheet.addRow(row);
    });

    await logActivity(req.session.user, 'Download Excel', 'User downloaded data in Excel');


    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="data_export.xlsx"'
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exporting Excel:', err);
    res.status(500).send('Failed to export Excel file');
  }
});


// upload route 


// app.post('/upload-data', upload.single('upload'), async (req, res) => {
//   if (!req.file) return res.status(400).send('No file uploaded.');

//   const filePath = req.file.path;
//   const ext = path.extname(filePath).toLowerCase();
//   const rows = [];

//   try {
//     if (ext === '.csv') {
//       const fs = await import('fs');
//       fs.createReadStream(filePath)
//         .pipe(csv())
//         .on('data', (row) => {
//           console.log('Parsed CSV row:', row);
//           rows.push(row);
//         })
//         .on('end', async () => {
//           console.log('All CSV rows:', rows);
//           await insertRows(rows, req, res);
//         });
//     } else if (ext === '.xlsx' || ext === '.xls') {
//       const workbook = xlsx.readFile(filePath);
//       const sheetName = workbook.SheetNames[0];
//       const sheet = workbook.Sheets[sheetName];
//       const data = xlsx.utils.sheet_to_json(sheet, { defval: null });
//       console.log('Parsed Excel data:', data);

//       // Map Excel columns to expected fields
//       const mappedRows = data
//         .filter((row, index) => {
//           // Skip the header row
//           if (row.__EMPTY === 'ID' && row['EARTHQUAKES RECORDED IN AFRICA; NOVEMBER 2024'] === 'MM'){
//             return false;
//           }
//           if (row.__EMPTY == null){
//             console.warn(`Skipping row ${index + 2} with null id:`,row);
//             return false;
//           }
//           return true;
//         })
//         .map((row, index) => {
//           // Safely handle fields
//           const safeString = (value) => {
//             if (typeof value === 'string') return value.trim();
//             if (value == null) return null;
//             return isFinite(value) ? value.toString() : null;
//           };

//           const safeNumber = (value) => {
//             if (value == null) return 0;
//             if (typeof value === 'string') {
//               const cleaned = value.replace(/f$/, '');
//               return isFinite(cleaned) ? parseFloat(cleaned) : 0;
//             }
//             return isFinite(value) ? parseFloat(value) : 0;
//           };

//           // Debug the raw MM column value
//           const rawMM = row['EARTHQUAKES RECORDED IN AFRICA; NOVEMBER 2024'];
//           const rawH =row.__EMPTY_7;
//           const rawMb = row.__EMPTY_8;
//           if (rawH == null || rawMb == null) {
//             console.warn(`Missing MM value in row ${index + 2}:`,{rawH,rawMb,row} );
//           }

//           const rowData = {
//             id: safeNumber(row.__EMPTY),
//             mm: safeString(rawMM) || 'NOV', // Default to 'NOV' if missing
//             year: safeNumber(row.__EMPTY_1),
//             day: safeNumber(row.__EMPTY_2),
//             hr: safeNumber(row.__EMPTY_3),
//             minute: safeNumber(row.__EMPTY_4),
//             second: safeNumber(row.__EMPTY_5),
//             latitude: safeNumber(row.__EMPTY_6),
//             longitude: safeNumber(row.__EMPTY_7),
//             h: safeNumber(rawH),
//             mb: safeNumber(rawMb),
//             ml: safeNumber(row.__EMPTY_10),
//             az: safeNumber(row.__EMPTY_11),
//             location: safeString(row.__EMPTY_12),
//             nearest_location: safeString(row.__EMPTY_13)
//           };

//           // Log warnings for invalid values
//           Object.entries(rowData).forEach(([key, value]) => {
//             if (value === null && key !== 'ml') {
//               console.warn(`Invalid ${key} in row ${index + 2}:`, row[key]);
//             }
//           });

//           return rowData;
//         });

//       console.log('Mapped Excel rows:', mappedRows);
//       await insertRows(mappedRows, req, res);
//     } else {
//       return res.status(400).send('Unsupported file format. Upload .csv or .xlsx only.');
//     }
//   } catch (err) {
//     console.error('Error processing uploaded file:', err.stack);
//     res.status(500).send('Error processing file: ' + err.message);
//   }
// });
 


 
//  app.post('/upload-data', upload.single('upload'), async (req, res) => {
//   if (!req.file) return res.status(400).send('No file uploaded.');

//   const filePath = req.file.path;
//   const ext = path.extname(filePath).toLowerCase();
//   const rows = [];

//   try {
//     if (ext === '.csv') {
//       const fs = await import('fs');
//       fs.createReadStream(filePath)
//         .pipe(csv())
//         .on('data', (row) => {
//           console.log('Parsed CSV row:', row);
//           rows.push(row);
//         })
//         .on('end', async () => {
//           console.log('All CSV rows:', rows);
//           await insertRows(rows, req, res);
//         });
//     } else if (ext === '.xlsx' || ext === '.xls') {
//       const workbook = xlsx.readFile(filePath);
//       const sheetName = workbook.SheetNames[0];
//       const sheet = workbook.Sheets[sheetName];
//       const data = xlsx.utils.sheet_to_json(sheet, { defval: null, header: 1 });

//       // Log raw data for debugging
//       console.log('Raw Excel data:', data);

//       // Skip header row and map data
//       const mappedRows = data.slice(1).filter((row, index) => {

//         // Validate required fields (excluding id)

//       if (!row[0] || !row[2] || !row[3] || !row[4] || !row[5] || !row[6] || !row[7] || !isFinite(row[8]) || !isFinite(row[9]) || !row[10] || !row[11] || !row[12] || !row[13]) {
//           console.warn(`Skipping row ${index + 2} with missing or invalid fields:`, row);
//           return false;  
//         }
//         return true;
//       }).map((row, index) => {
//         const safeString = (value) => {
//           if (typeof value === 'string') return value.trim();
//           if (value == null) return null;
//           return isFinite(value) ? value.toString() : null;
//         };

//         const safeNumber = (value) => {
//           if (value == null) return null;
//           if (typeof value === 'string') {
//             const cleaned = value.replace(/f$/, '');
//             return isFinite(cleaned) ? parseFloat(cleaned) : null;
//           }
//           return isFinite(value) ? parseFloat(value) : null;
//         };

//         return {
//           day: safeNumber(row[0]),
//           mm: safeString(row[1]) || 'NOV',
//           year: safeNumber(row[2]),
//           minute: safeNumber(row[3]),
//           second: safeNumber(row[4]),
//           hr: safeNumber(row[5]),
//           latitude: safeNumber(row[6]),
//           longitude: safeNumber(row[7]),
//           h: safeNumber(row[8]),
//           mb: safeNumber(row[9]),
//           ml: safeNumber(row[10]),
//           az: safeNumber(row[11]),
//           location: safeString(row[12]),
//           nearest_location: safeString(row[13])
//         };
//       });

//       console.log('Mapped Excel rows:', mappedRows);
//       await insertRows(mappedRows, req, res);
//     } else {
//       return res.status(400).send('Unsupported file format. Upload .csv or .xlsx only.');
//     }
//   } catch (err) {
//     console.error('Error processing uploaded file:', err.stack);
//     res.status(500).send('Error processing file: ' + err.message);
//   }
// });
app.post('/upload-data', upload.single('upload'), async (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');

  const filePath = req.file.path;
  const ext = path.extname(filePath).toLowerCase();
  const rows = [];

  try {
    if (ext === '.csv') {
      const fs = await import('fs');
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          console.log('Parsed CSV row:', row);
          rows.push(row);
        })
        .on('end', async () => {
          console.log('All CSV rows:', rows);
          await insertRows(rows, req, res);
        });
    } else if (ext === '.xlsx' || ext === '.xls') {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet, { defval: null, header: 1 });

      // Log raw data for debugging
      console.log('Raw Excel data:', data);

      // Skip header row and map/clean data first, then filter
      const mappedRows = data.slice(1).map((row, index) => {
        const safeString = (value) => {
          if (typeof value === 'string') return value.trim();
          if (value == null) return null;
          return isFinite(value) ? value.toString() : null;
        };

        const safeNumber = (value) => {
          if (value == null) return null;
          if (typeof value === 'string') {
            const cleaned = value.replace(/f$/i, ''); // Case-insensitive regex to handle 'F' or 'f'
            return isFinite(cleaned) ? parseFloat(cleaned) : null;
          }
          return isFinite(value) ? parseFloat(value) : null;
        };

        return {
          day: safeNumber(row[0]),
          mm: safeString(row[1]) || 'NOV',
          year: safeNumber(row[2]),
          minute: safeNumber(row[3]),
          second: safeNumber(row[4]),
          hr: safeNumber(row[5]),
          latitude: safeNumber(row[6]),
          longitude: safeNumber(row[7]),
          h: safeNumber(row[8]),
          mb: safeNumber(row[9]),
          ml: safeNumber(row[10]),
          az: safeNumber(row[11]),
          location: safeString(row[12]),
          nearest_location: safeString(row[13])
        };
      }).filter((cleanedRow, index) => {
        // Skip completely empty rows
        if (Object.values(cleanedRow).every(value => value === null || value === undefined)) {
          console.warn(`Skipping row ${index + 2} because it is completely empty`);
          return false;
        }
        // Validate required fields after cleaning (mb and ml are optional, so don't check isFinite if null)
        if (
          cleanedRow.day === null || cleanedRow.year === null || cleanedRow.minute === null ||
          cleanedRow.second === null || cleanedRow.hr === null || cleanedRow.latitude === null ||
          cleanedRow.longitude === null || !isFinite(cleanedRow.h) || cleanedRow.az === null ||
          !cleanedRow.location || !cleanedRow.nearest_location
        ) {
          console.warn(`Skipping row ${index + 2} with missing or invalid fields after cleaning:`, cleanedRow);
          return false;
        }
        // For optional mb/ml, allow null but log if non-finite when present
        if (cleanedRow.mb !== null && !isFinite(cleanedRow.mb)) {
          console.warn(`Skipping row ${index + 2} due to invalid mb after cleaning:`, cleanedRow);
          return false;
        }
        return true;
      });

      console.log('Mapped Excel rows:', mappedRows);
      await insertRows(mappedRows, req, res);
    } else {
      return res.status(400).send('Unsupported file format. Upload .csv or .xlsx only.');
    }
  } catch (err) {
    console.error('Error processing uploaded file:', err.stack);
    res.status(500).send('Error processing file: ' + err.message);
  } finally {
    try {
      await fs.unlink(filePath);
    } catch (unlinkErr) {
      console.warn('Failed to delete uploaded file:', unlinkErr);
    }
  }
});



async function insertRows(rows, req, res) {
  try {
    let insertedCount = 0;
    let skippedCount = 0;

    for (const row of rows) {
      const {
        day, mm, year, minute, second, hr,
        latitude, longitude, h, mb, ml, az,
        location, nearest_location
      } = row;

      // Validate required fields (mm is now optional)
    
      if (
        !day || !year || !minute || !second || !hr ||
        !latitude || !longitude || !isFinite(h) || !isFinite(mb) || !az ||
        !location || !nearest_location
      ) {
        console.warn(`Skipping row with missing fields:`, row);
        skippedCount++;
        continue;
      }

      // Convert data types if needed
      const cleanedRow = { 
        day: parseInt(day, 10),
        mm,
        year: parseInt(year, 10),
        minute: parseInt(minute, 10),
        second: parseFloat(second),
        hr: parseInt(hr, 10),
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        h: parseFloat(h) || 0,
        mb: parseFloat(mb),
        ml: ml ? parseFloat(ml) : null,
        az: parseInt(az, 10),
        location,
        nearest_location
      };

      await db.query(`
        INSERT INTO data (
          day, mm, year, minute, second, hr,
          latitude, longitude, h, mb, ml, az,
          location, nearest_location
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
        )
        ON CONFLICT (id) DO UPDATE SET
          day = EXCLUDED.day,
          mm = EXCLUDED.mm,
          year = EXCLUDED.year,
          minute = EXCLUDED.minute,
          second = EXCLUDED.second,
          hr = EXCLUDED.hr,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          h = EXCLUDED.h,
          mb = EXCLUDED.mb,
          ml = EXCLUDED.ml,
          az = EXCLUDED.az,
          location = EXCLUDED.location,
          nearest_location = EXCLUDED.nearest_location
      RETURNING id`, [
        cleanedRow.day, cleanedRow.mm, cleanedRow.year, cleanedRow.minute,
        cleanedRow.second, cleanedRow.hr, cleanedRow.latitude, cleanedRow.longitude,
        cleanedRow.h, cleanedRow.mb, cleanedRow.ml, cleanedRow.az,
        cleanedRow.location, cleanedRow.nearest_location
      ]);

      insertedCount++;
    }

    await logActivity(req.session.user, 'Upload Data', `${insertedCount} records uploaded, ${skippedCount} records skipped due to invalid data`);

    res.redirect(`/manage-data?success=Uploaded ${insertedCount} records successfully, skipped ${skippedCount} invalid rows`);
  } catch (err) {
    console.error('Error inserting uploaded data:', err.stack);
    res.status(500).send('Error saving uploaded data: ' + err.message);
  }
}






app.get('/forgot-password', (req, res) => {
  const success = req.query.success || null;
  const error = req.query.error || null;
  res.render('forgot-password', { success, error });
});

app.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  try {
    const results = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = results.rows[0];

    if (!user) {
      await logActivity(null, 'Forgot Password Attempt', `No user found for email: ${email}`);
      return res.render('forgot-password', {
        success: null,
        error: 'No account with that email address exists.'
      });
    }

    // Generate reset token
    const token = crypto.randomBytes(20).toString('hex');
    const expires = new Date(Date.now() + 3600000); // 1 hour

    // Store token and expiration in database
    await db.query(
      `UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE email = $3`,
      [token, expires, email]
    );

    // Send reset email
    const resetLink = `http://localhost:${port}/reset-password/${token}`;
    const mailOptions = {
      to: user.email,
      from: process.env.EMAIL_USER,
      subject: 'Password Reset Request',
      text: `You are receiving this email because you (or someone else) requested a password reset.\n\n
             Please click the following link to reset your password:\n\n
             ${resetLink}\n\n
             If you did not request this, please ignore this email.`
    };

    await transporter.sendMail(mailOptions);
    await logActivity(user, 'Forgot Password', `Password reset link sent to ${email}`);

    res.render('forgot-password', {
      success: 'A password reset link has been sent to your email.',
      error: null
    });
  } catch (err) {
    console.error('Error processing forgot password:', err);
    await logActivity(null, 'Forgot Password Error', `Error for email: ${email}`);
    res.render('forgot-password', {
      success: null,
      error: 'An error occurred. Please try again.'
    });
  }
});

// Reset Password Routes
app.get('/reset-password/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const results = await db.query(
      `SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > $2`,
      [token, new Date()]
    );
    const user = results.rows[0];

    if (!user) {
      await logActivity(null, 'Invalid Reset Token', `Token: ${token}`);
      return res.render('forgot-password', {
        success: null,
        error: 'Password reset token is invalid or has expired.'
      });
    }

    res.render('reset-password', { token, success: null, error: null });
  } catch (err) {
    console.error('Error verifying reset token:', err);
    await logActivity(null, 'Reset Password Error', `Error verifying token: ${token}`);
    res.render('forgot-password', {
      success: null,
      error: 'An error occurred. Please try again.'
    });
  }
});

app.post('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  const { password, 'confirm-password': confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res.render('reset-password', {
      token,
      success: null,
      error: 'Passwords do not match.'
    });
  }

  try {
    const results = await db.query(
      `SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > $2`,
      [token, new Date()]
    );
    const user = results.rows[0];

    if (!user) {
      await logActivity(null, 'Invalid Reset Token', `Token: ${token}`);
      return res.render('forgot-password', {
        success: null,
        error: 'Password reset token is invalid or has expired.'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password and clear reset token
    await db.query(
      `UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE email = $2`,
      [hashedPassword, user.email]
    );

    await logActivity(user, 'Password Reset', `Password reset successfully for ${user.email}`);

    res.render('reset-password', {
      token,
      success: 'Password has been reset successfully. You can now log in.',
      error: null
    });
  } catch (err) {
    console.error('Error resetting password:', err);
    await logActivity(null, 'Reset Password Error', `Error for token: ${token}`);
    res.render('reset-password', {
      token,
      success: null,
      error: 'An error occurred. Please try again.'
    });
  }
});




// working on new fields 
app.get('/',(req,res)=>{
    const success = req.query.success || null;
    const error = req.query.error || null;
  res.render('edit-home',{success, error})
});




// Serve CSV template
app.get('/download-template-csv', (req, res) => {
  const templatePath = path.join(__dirname, 'public', 'data_template.csv');
  res.download(templatePath, 'data_template.csv', (err) => {
    if (err) {
      console.error('Error serving CSV template:', err);
      res.status(500).send('Error downloading template');
    }
  });
});

// Serve Excel template
app.get('/download-template-excel', async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Data Template');

    // Define headers
    worksheet.columns = [ 
      { header: 'day', key: 'day', width: 10 },
      { header: 'mm', key: 'mm', width: 10 },
      { header: 'year', key: 'year', width: 10 },
      { header: 'minute', key: 'minute', width: 10 },
      { header: 'second', key: 'second', width: 10 },
      { header: 'hr', key: 'hr', width: 10 },
      { header: 'latitude', key: 'latitude', width: 15 },
      { header: 'longitude', key: 'longitude', width: 15 },
      { header: 'h', key: 'h', width: 10 },
      { header: 'mb', key: 'mb', width: 10 },
      { header: 'ml', key: 'ml', width: 10 },
      { header: 'az', key: 'az', width: 10 },
      { header: 'location', key: 'location', width: 20 },
      { header: 'nearest_location', key: 'nearest_location', width: 20 }
    ];

    // Add sample row
    worksheet.addRow({ 
      day: 15,
      mm:'NOV',
      year: 2025,
      minute: 30,
      second: 45.5,
      hr: 14,
      latitude: 5.12345,
      longitude: -1.23456,
      h: 10.0,
      mb: 4.5,
      ml: 4.2,
      az: 90,
      location: 'Ghana',
      nearest_location: 'Accra'
    });

    // Set headers for Excel file
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="data_template.xlsx"'
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error generating Excel template:', err);
    res.status(500).send('Error downloading template');
  }
});


app.get('/library', isAuthenticated, async (req, res) => {
  try {
    const results = await db.query(`
      SELECT id, name, upload_date, type, size,category
      FROM files
      ORDER BY upload_date DESC
    `);
    await logActivity(req.session.user, 'View Library', 'User accessed library page');
    res.render('library.ejs', {
      users: req.session.user,
      files: results.rows,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    console.error('Error fetching files:', err);
    await logActivity(req.session.user, 'View Library Error', 'Error fetching files');
    res.redirect('/library?error=Error loading library');
  }
});

app.post('/upload-file', isAuthenticated, upload.single('upload'), async (req, res) => {
  if (!req.file) {
    await logActivity(req.session.user, 'Upload File Failed', 'No file uploaded');
    return res.redirect('/library?error=No file uploaded');
  }
  try {
    const { originalname, mimetype, size, filename } = req.file;
    const { category } = req.body; // Added category from form
    const fileData = {
      name: originalname,
      type: mimetype,
      size: (size / 1024).toFixed(2) + ' KB',
      path: `/Uploads/${filename}`,
      upload_date: new Date(),
      category: category || 'Uncategorized' // Default to 'Uncategorized' if none provided
    };
    await db.query(`
      INSERT INTO files (name, type, size, path, upload_date, category)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      fileData.name,
      fileData.type,
      fileData.size,
      fileData.path,
      fileData.upload_date,
      fileData.category

    ]);
    await logActivity(req.session.user, 'Upload File', `Uploaded file: ${originalname}`);
    res.redirect('/library?success=File uploaded successfully');
  } catch (err) {
    console.error('Error saving file metadata:', err);
    await logActivity(req.session.user, 'Upload File Error', `Error uploading file: ${req.file?.originalname || 'unknown'}`);
    res.redirect('/library?error=Error uploading file');
  }
});

app.get('/download-file/:id', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('SELECT name, path FROM files WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      await logActivity(req.session.user, 'Download File Failed', `File ID ${id} not found`);
      return res.redirect('/library?error=File not found');
    }
    const file = result.rows[0];
    const filePath = path.join(__dirname, file.path);
    await logActivity(req.session.user, 'Download File', `Downloaded file: ${file.name}`);
    res.download(filePath, file.name, (err) => {
      if (err) {
        console.error('Error downloading file:', err);
        res.redirect('/library?error=Error downloading file');
      }
    });
  } catch (err) {
    console.error('Error fetching file for download:', err);
    await logActivity(req.session.user, 'Download File Error', `Error fetching file ID ${id}`);
    res.redirect('/library?error=Error downloading file');
  }
});

app.delete('/delete-file/:id', isAuthenticated, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('SELECT name, path FROM files WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      await logActivity(req.session.user, 'Delete File Failed', `File ID ${id} not found`);
      return res.redirect('/library?error=File not found');
    }
    const file = result.rows[0];
    const filePath = path.join(__dirname, file.path);
    await fs.unlink(filePath);
    await db.query('DELETE FROM files WHERE id = $1', [id]);
    await logActivity(req.session.user, 'Delete File', `Deleted file: ${file.name}`); 
    res.redirect('/library?success=File deleted successfully');
  } catch (err) {
    console.error('Error deleting file:', err);
    await logActivity(req.session.user, 'Delete File Error', `Error deleting file ID ${id}`);
    res.redirect('/library?error=Error deleting file');
  }
});

app.get('/recordMap',async (req,res)=>{
  res.render('recordMap',{
    users: req.session.user
  })
})


app.listen(port,()=>{
  console.log(`server runing on port ${port}`)
})

