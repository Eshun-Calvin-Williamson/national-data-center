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


const passcode =async (req,res,next)=>{
  const {id,password,email} =req.body;


try {
    const results =await db.query(`SELECT id, user_name, email, image, password,role FROM users WHERE email = $1`,[email]);
    
    const users =results.rows[0];
    
    if(users){
      if(password === users.password){
        req.session.user =users;
        req.users =users;
        validUSer =true;
        await logActivity(users, 'Login', 'User logged in successfully');
      }else{
        validUSer =false
      }
    }
    else{
      validUSer =false;
      await logActivity(null, 'Failed Login', `Attempted login for ${email}`);
    }
    if(!validUSer){
      return res.redirect('/?error=Login failed, please check your credentials');
    }
    next();
} catch (err) {
  console.error(`Error checking credentials`)
  res.status(500).send('Error Checking credentials')
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


// app.get('/', (req, res) => {
//   const success = req.query.success || null;
//   const error = req.query.error || null;

//   res.render('home', { success, error });
// });



app.get('/user',isAuthenticated ,(req,res)=>{
if(req.session.user?.role !== 'admin'){
  return res.status(403).send('Access denied')
}
  res.render('user.ejs',{ user: req.session.user})
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
  res.render('add.ejs',{users: req.session.user})
})

 

app.get('/activities', isAuthenticated, requireAdmin, async (req, res) => {

  try {
    const logs = await db.query('SELECT * FROM activity_logs ORDER BY timestamp DESC');

    res.render('activities.ejs',
       { 
          logs: logs.rows,
          users: req.session.users
       });


  } catch (err) {
    console.error('Error fetching activity logs:', err);
    res.status(500).send('Error fetching logs');
  }
});

 

// map route 
app.get('/map',(req,res)=>{
  res.render('map')
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
        users: req.users,
        data: dataResults.rows
    })

  } catch (err) {
    console.error('Error fetching data for dashboard:', err);
    res.status(500).send('Error loading dashboard');
  }

  if(validUSer){
  }else{
    res.send('wrong message :: Check logins')
  }
})


app.post('/add',upload.single('photo'), isAuthenticated, async (req,res)=>{

  const {id,password,email,name,role} =req.body;
  const image = req.file ? `/uploads/${req.file.filename}`: null;
  const hashedPassword =await bcrypt.hash(password,10)

  try {
    await db.query(`INSERT INTO users (id,password,email,image,user_name,role)
       VALUES
       ($1,$2,$3,$4,$5,$6)`
       ,[id,password,email,image,name,role]);

       await logActivity(req.session.user, 'Create User', `User ${email} added`);

       res.redirect('/?success=User added successfully');
      } catch (err) {
    console.error('Error inserting data',err);
    res.status(500).send('error saving data');
  }
})

 

app.post('/events', async (req, res) => {
  const {
    id,
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
    !id || !day || !month || !year || !minute || !second || !hour ||
    !latitude || !longitude || !H || !Mb ||
    !Ml || !Az || !location || !nearest_location
  ) {
    return res.status(400).send('All fields must be filled out.');
  }

  try {
    await db.query(`
      INSERT INTO data (
        id, day, mm, year, minute, second, hr, latitude, longitude, h, mb, ml, az, location, nearest_location
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,$13,$14,$15
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
    `, [
      id,
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

    await logActivity(req.session.user, 'Add/Update Event', `Event ${id} added or updated`);


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
    sqlQuery = `SELECT * FROM data WHERE ${column}::TEXT = $1`;
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
        mb::TEXT = $1 OR
        ml::TEXT = $1 OR
        az::TEXT = $1 OR
        location = $1 OR
        nearest_location = $1
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
      location: row.location || null,
      nearest_location: row.nearest_location || null
    }));

    await logActivity(req.session.user, 'Access Dashboard', 'User accessed dashboard');


    const usersResults = await db.query('SELECT id, email, image,user_name FROM users');


    res.render('dashboard.ejs', { metrics, users:usersResults.rows,
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
      const data = xlsx.utils.sheet_to_json(sheet, { defval: null });
      console.log('Parsed Excel data:', data);

      // Map Excel columns to expected fields
      const mappedRows = data
        .filter((row, index) => {
          // Skip the header row
          if (row.__EMPTY === 'ID' && row['EARTHQUAKES RECORDED IN AFRICA; NOVEMBER 2024'] === 'MM'){
            return false;
          }
          if (row.__EMPTY == null){
            console.warn(`Skipping row ${index + 2} with null id:`,row);
            return false;
          }
          return true;
        })
        .map((row, index) => {
          // Safely handle fields
          const safeString = (value) => {
            if (typeof value === 'string') return value.trim();
            if (value == null) return null;
            return isFinite(value) ? value.toString() : null;
          };

          const safeNumber = (value) => {
            if (value == null) return 0;
            if (typeof value === 'string') {
              const cleaned = value.replace(/f$/, '');
              return isFinite(cleaned) ? parseFloat(cleaned) : 0;
            }
            return isFinite(value) ? parseFloat(value) : 0;
          };

          // Debug the raw MM column value
          const rawMM = row['EARTHQUAKES RECORDED IN AFRICA; NOVEMBER 2024'];
          const rawH =row.__EMPTY_7;
          const rawMb = row.__EMPTY_8;
          if (rawH == null || rawMb == null) {
            console.warn(`Missing MM value in row ${index + 2}:`,{rawH,rawMb,row} );
          }

          const rowData = {
            id: safeNumber(row.__EMPTY),
            mm: safeString(rawMM) || 'NOV', // Default to 'NOV' if missing
            year: safeNumber(row__EMPTY_1),
            day: safeNumber(row.__EMPTY_2),
            hr: safeNumber(row.__EMPTY_3),
            minute: safeNumber(row.__EMPTY_4),
            second: safeNumber(row.__EMPTY_5),
            latitude: safeNumber(row.__EMPTY_6),
            longitude: safeNumber(row.__EMPTY_7),
            h: safeNumber(rawH),
            mb: safeNumber(rawMb),
            ml: safeNumber(row.__EMPTY_10),
            az: safeNumber(row.__EMPTY_11),
            location: safeString(row.__EMPTY_12),
            nearest_location: safeString(row.__EMPTY_13)
          };

          // Log warnings for invalid values
          Object.entries(rowData).forEach(([key, value]) => {
            if (value === null && key !== 'ml') {
              console.warn(`Invalid ${key} in row ${index + 2}:`, row[key]);
            }
          });

          return rowData;
        });

      console.log('Mapped Excel rows:', mappedRows);
      await insertRows(mappedRows, req, res);
    } else {
      return res.status(400).send('Unsupported file format. Upload .csv or .xlsx only.');
    }
  } catch (err) {
    console.error('Error processing uploaded file:', err.stack);
    res.status(500).send('Error processing file: ' + err.message);
  }
});



async function insertRows(rows, req, res) {
  try {
    let insertedCount = 0;
    let skippedCount = 0;

    for (const row of rows) {
      const {
        id, day, mm, year, minute, second, hr,
        latitude, longitude, h, mb, ml, az,
        location, nearest_location
      } = row;

      // Validate required fields (mm is now optional)
      if (!id || id === '' || id === null || id === undefined || !isFinite(id)) {
        console.warn(`Skipping row with missing or invalid id:`, row);
        skippedCount++;
        continue;
      }
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
        id: parseInt(id, 10),
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
          id, day, mm, year, minute, second, hr,
          latitude, longitude, h, mb, ml, az,
          location, nearest_location
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,$15
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
      `, [
        cleanedRow.id, cleanedRow.day, cleanedRow.mm, cleanedRow.year, cleanedRow.minute,
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
      { header: 'id', key: 'id', width: 10 },
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
      id: 1,
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



app.listen(port,()=>{
  console.log(`server runing on port ${port}`)
})

