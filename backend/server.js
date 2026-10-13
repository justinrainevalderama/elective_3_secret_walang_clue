require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Supabase connection
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// ========================================
// admin checker
// ========================================

async function checkAdmin(userId) {
    if (!userId) {
        return false;
    }

    const { data: profile, error } = await supabase
        .from("profiles")
        .select("account_type")
        .eq("id", userId)
        .single();

    if (error || !profile) {
        return false;
    }

    return profile.account_type === "admin";
}

// ========================================
// TEST ROUTE
// ========================================

app.get("/", (req, res) => {

    res.json({
        success: true,
        message: "CPE Laptop Borrowing Backend is running!"
    });

});


// ========================================
// CREATE ACCOUNT
// ========================================

app.post("/api/register", async (req, res) => {
    try {
        const {
            fullName,
            institutionalId,
            email,
            password
        } = req.body;

        // Check required fields
        if (!fullName || !institutionalId || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "All fields are required."
            });
        }

        // Check password length
        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters."
            });
        }

        // Create authentication account
        const {
            data: authData,
            error: authError
        } = await supabase.auth.admin.createUser({
            email: email.trim().toLowerCase(),
            password: password,
            email_confirm: true
        });

        if (authError) {
            console.error("Authentication error:", authError);

            return res.status(400).json({
                success: false,
                message: authError.message
            });
        }

        const userId = authData.user.id;

        // Save student information
        const { error: profileError } = await supabase
            .from("profiles")
            .insert({
                id: userId,
                full_name: fullName.trim(),
                institutional_id: institutionalId.trim(),
                account_type: "student"
            });

        if (profileError) {
            console.error("Profile error:", profileError);

            // Delete Auth account if profile creation fails
            await supabase.auth.admin.deleteUser(userId);

            return res.status(500).json({
                success: false,
                message: "Failed to save student information."
            });
        }

        return res.status(201).json({
            success: true,
            message: "Student account created successfully.",
            user: {
                id: userId,
                email: authData.user.email,
                fullName: fullName,
                institutionalId: institutionalId,
                accountType: "student"
            }
        });

    } catch (error) {
        console.error("Server error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
});

// ========================================
// LOGIN 
// ========================================

app.post("/api/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        // Check required fields
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required."
            });
        }

        // Login through Supabase Authentication
        const {
            data: authData,
            error: authError
        } = await supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password: password
        });

        if (authError) {
            console.error("Login error:", authError);

            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        // Get the user's profile
        const {
            data: profile,
            error: profileError
        } = await supabase
            .from("profiles")
            .select("full_name, institutional_id, account_type")
            .eq("id", authData.user.id)
            .single();

        if (profileError || !profile) {
            console.error("Profile error:", profileError);

            return res.status(500).json({
                success: false,
                message: "User profile could not be found."
            });
        }

        // Check if the account is an admin
        if (profile.account_type === "admin") {
            return res.status(200).json({
                success: true,
                message: "Admin login successful.",
                user: {
                    id: authData.user.id,
                    email: authData.user.email,
                    fullName: profile.full_name,
                    institutionalId: profile.institutional_id,
                    accountType: "admin"
                },
                session: authData.session
            });
        }

        // Student account
        if (profile.account_type === "student") {
            return res.status(200).json({
                success: true,
                message: "Student login successful.",
                user: {
                    id: authData.user.id,
                    email: authData.user.email,
                    fullName: profile.full_name,
                    institutionalId: profile.institutional_id,
                    accountType: "student"
                },
                session: authData.session
            });
        }

        // Unknown account type
        return res.status(403).json({
            success: false,
            message: "Invalid account type."
        });

    } catch (error) {
        console.error("Server error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
});

// ========================================
// display laptop
// ========================================

app.get("/api/laptops", async (req, res) => {
    try {
        const { data: laptops, error } = await supabase
            .from("laptops")
            .select("id, laptop_name, laptop_code, status")
            .order("laptop_code", { ascending: true });

        if (error) {
            console.error("Laptop error:", error);

            return res.status(500).json({
                success: false,
                message: "Failed to retrieve laptops."
            });
        }

        const laptopList = laptops.map((laptop) => ({
            id: laptop.id,
            name: laptop.laptop_name,
            code: laptop.laptop_code,
            status: laptop.status,
            message:
                laptop.status === "available"
                    ? "Laptop is available."
                    : "Laptop is unavailable."
        }));

        return res.status(200).json({
            success: true,
            laptops: laptopList
        });

    } catch (error) {
        console.error("Server error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
});

// ========================================
// borrowing
// ========================================

app.post("/api/borrow", async (req, res) => {
    try {
        const { userId, laptopId } = req.body;

        if (!userId || !laptopId) {
            return res.status(400).json({
                success: false,
                message: "User ID and laptop ID are required."
            });
        }

        // Check if the user is a student
        const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("account_type")
            .eq("id", userId)
            .single();

        if (profileError || !profile) {
            return res.status(404).json({
                success: false,
                message: "User profile not found."
            });
        }

        if (profile.account_type !== "student") {
            return res.status(403).json({
                success: false,
                message: "Only students can borrow laptops."
            });
        }

        // Check if laptop exists and is available
        const { data: laptop, error: laptopError } = await supabase
            .from("laptops")
            .select("id, laptop_name, laptop_code, status")
            .eq("id", laptopId)
            .single();

        if (laptopError || !laptop) {
            return res.status(404).json({
                success: false,
                message: "Laptop not found."
            });
        }

        if (laptop.status !== "available") {
            return res.status(400).json({
                success: false,
                message: "Laptop is unavailable."
            });
        }

        // Create borrowing record
        const { data: borrowing, error: borrowingError } = await supabase
            .from("borrowings")
            .insert({
                user_id: userId,
                laptop_id: laptopId,
                status: "borrowed"
            })
            .select()
            .single();

        if (borrowingError) {
            console.error("Borrowing error:", borrowingError);

            return res.status(500).json({
                success: false,
                message: "Failed to borrow laptop."
            });
        }

        // Change laptop status to borrowed
        const { error: updateError } = await supabase
            .from("laptops")
            .update({
                status: "borrowed"
            })
            .eq("id", laptopId);

        if (updateError) {
            console.error("Laptop status error:", updateError);

            return res.status(500).json({
                success: false,
                message: "Borrowing was recorded, but laptop status could not be updated."
            });
        }

        return res.status(201).json({
            success: true,
            message: "Laptop borrowed successfully.",
            borrowing: borrowing
        });

    } catch (error) {
        console.error("Server error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
});


// ========================================
// RETURN LAPTOP
// POST /api/return
// ========================================
app.post("/api/return", async (req, res) => {
    try {
        const { userId, laptopId } = req.body;

        // Validate required fields
        if (!userId || !laptopId) {
            return res.status(400).json({
                success: false,
                message: "User ID and Laptop ID are required."
            });
        }

        console.log("Return request:", { userId, laptopId });

        // Verify that the user exists
        const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("id, account_type")
            .eq("id", userId)
            .maybeSingle();

        if (profileError) {
            console.error("Profile lookup error:", profileError);

            return res.status(500).json({
                success: false,
                message: "Failed to verify user."
            });
        }

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: "User profile was not found."
            });
        }

        if (profile.account_type !== "student") {
            return res.status(403).json({
                success: false,
                message: "Only students can return borrowed laptops."
            });
        }

        // Find the student's active borrowing record
        const { data: borrowing, error: borrowingError } = await supabase
            .from("borrowings")
            .select("id, user_id, laptop_id, status")
            .eq("user_id", userId)
            .eq("laptop_id", laptopId)
            .eq("status", "borrowed")
            .maybeSingle();

        if (borrowingError) {
            console.error("Borrowing lookup error:", borrowingError);

            return res.status(500).json({
                success: false,
                message: "Failed to check the active borrowing record."
            });
        }

        if (!borrowing) {
            return res.status(404).json({
                success: false,
                message: "No active borrowing record was found for this laptop."
            });
        }

        // Mark the borrowing record as returned
        const { data: updatedBorrowing, error: updateBorrowingError } =
            await supabase
                .from("borrowings")
                .update({
                    status: "returned",
                    returned_at: new Date().toISOString()
                })
                .eq("id", borrowing.id)
                .eq("user_id", userId)
                .eq("status", "borrowed")
                .select("id")
                .maybeSingle();

        if (updateBorrowingError) {
            console.error(
                "Update borrowing error:",
                updateBorrowingError
            );

            return res.status(500).json({
                success: false,
                message: "Failed to update the borrowing record."
            });
        }

        if (!updatedBorrowing) {
            return res.status(409).json({
                success: false,
                message: "This borrowing record has already been returned."
            });
        }

        // Make the laptop available again
        const { data: updatedLaptop, error: updateLaptopError } =
            await supabase
                .from("laptops")
                .update({ status: "available" })
                .eq("id", borrowing.laptop_id)
                .select("id")
                .maybeSingle();

        if (updateLaptopError || !updatedLaptop) {
            console.error(
                "Update laptop error:",
                updateLaptopError
            );

            return res.status(500).json({
                success: false,
                message:
                    "The borrowing was marked returned, but the laptop status could not be updated. Please contact the administrator."
            });
        }

        return res.status(200).json({
            success: true,
            message: "Laptop returned successfully."
        });

    } catch (error) {
        console.error("Return laptop server error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
});



/* ========================================
   STUDENT BORROWING HISTORY
   GET /api/borrowings/:userId
======================================== */

app.get("/api/borrowings/:userId", async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "User ID is required."
            });
        }

        // Confirm that this profile exists and is a student.
        const { data: profile, error: profileError } =
            await supabase
                .from("profiles")
                .select("id, account_type")
                .eq("id", userId)
                .single();

        if (profileError || !profile) {
            return res.status(404).json({
                success: false,
                message: "Student profile not found."
            });
        }

        if (profile.account_type !== "student") {
            return res.status(403).json({
                success: false,
                message: "Only students can access this endpoint."
            });
        }

        // Retrieve all borrowing records for this student.
        const { data: borrowings, error: borrowingError } =
            await supabase
                .from("borrowings")
                .select(`
                    id,
                    user_id,
                    laptop_id,
                    status,
                    borrowed_at,
                    returned_at
                `)
                .eq("user_id", userId)
                .order("borrowed_at", { ascending: false });

        if (borrowingError) {
            console.error("History error:", borrowingError);

            return res.status(500).json({
                success: false,
                message: "Failed to retrieve borrowing history."
            });
        }

        const laptopIds = [
            ...new Set(
                (borrowings || []).map(record => record.laptop_id)
            )
        ];

        let laptopMap = new Map();

        if (laptopIds.length > 0) {
            const { data: laptopRecords, error: laptopError } =
                await supabase
                    .from("laptops")
                    .select("id, laptop_name, laptop_code")
                    .in("id", laptopIds);

            if (laptopError) {
                console.error("Laptop history error:", laptopError);

                return res.status(500).json({
                    success: false,
                    message: "Failed to retrieve laptop details."
                });
            }

            laptopMap = new Map(
                (laptopRecords || []).map(laptop => [
                    String(laptop.id),
                    laptop
                ])
            );
        }

        const history = (borrowings || []).map(record => {
            const laptop = laptopMap.get(String(record.laptop_id));

            return {
                id: record.id,
                laptopId: record.laptop_id,
                laptopCode: laptop?.laptop_code || "Laptop removed",
                laptopName: laptop?.laptop_name || "Laptop removed",
                status: record.status,
                borrowedAt: record.borrowed_at,
                returnedAt: record.returned_at
            };
        });

        return res.status(200).json({
            success: true,
            history
        });

    } catch (error) {
        console.error("Server error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
});


// ========================================
// display laptops (admin)
// ========================================

app.get("/api/admin/laptops", async (req, res) => {
    try {
        const { userId } = req.query;

        if (!await checkAdmin(userId)) {
            return res.status(403).json({
                success: false,
                message: "Admin access required."
            });
        }

        const { data: laptops, error } = await supabase
            .from("laptops")
            .select("id, laptop_name, laptop_code, status")
            .order("laptop_code", { ascending: true });

        if (error) {
            console.error("Laptop error:", error);

            return res.status(500).json({
                success: false,
                message: "Failed to retrieve laptops."
            });
        }

        return res.status(200).json({
            success: true,
            laptops: laptops
        });

    } catch (error) {
        console.error("Server error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
});

// ========================================
// add laptops
// ========================================

app.post("/api/admin/laptops", async (req, res) => {
    try {
        const {
            userId,
            laptopName,
            laptopCode
        } = req.body;

        if (!userId || !laptopName || !laptopCode) {
            return res.status(400).json({
                success: false,
                message: "Admin ID, laptop name, and laptop code are required."
            });
        }

        // Check admin
        if (!await checkAdmin(userId)) {
            return res.status(403).json({
                success: false,
                message: "Admin access required."
            });
        }

        // Add laptop
        const { data: laptop, error } = await supabase
            .from("laptops")
            .insert({
                laptop_name: laptopName.trim(),
                laptop_code: laptopCode.trim(),
                status: "available"
            })
            .select()
            .single();

        if (error) {
            console.error("Add laptop error:", error);

            return res.status(400).json({
                success: false,
                message: "Failed to add laptop. Laptop code may already exist."
            });
        }

        return res.status(201).json({
            success: true,
            message: "Laptop added successfully.",
            laptop: laptop
        });

    } catch (error) {
        console.error("Server error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
});

// ========================================
// remove laptop
// ========================================

app.delete("/api/admin/laptops/:laptopId", async (req, res) => {
    try {
        const { userId } = req.body;
        const { laptopId } = req.params;

        if (!userId || !laptopId) {
            return res.status(400).json({
                success: false,
                message: "Admin ID and laptop ID are required."
            });
        }

        // Check admin
        if (!await checkAdmin(userId)) {
            return res.status(403).json({
                success: false,
                message: "Admin access required."
            });
        }

        // Check laptop
        const { data: laptop, error: laptopError } = await supabase
            .from("laptops")
            .select("id, laptop_name, laptop_code, status")
            .eq("id", laptopId)
            .single();

        if (laptopError || !laptop) {
            return res.status(404).json({
                success: false,
                message: "Laptop not found."
            });
        }

        // Don't allow removal of borrowed laptop
        if (laptop.status === "borrowed") {
            return res.status(400).json({
                success: false,
                message: "Cannot remove a laptop that is currently borrowed."
            });
        }

        // Delete laptop
        const { error: deleteError } = await supabase
            .from("laptops")
            .delete()
            .eq("id", laptopId);

        if (deleteError) {
            console.error("Delete laptop error:", deleteError);

            return res.status(500).json({
                success: false,
                message: "Failed to remove laptop."
            });
        }

        return res.status(200).json({
            success: true,
            message: "Laptop removed successfully."
        });

    } catch (error) {
        console.error("Server error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
});

// ========================================
// laptop logs  
// ========================================

app.get("/api/admin/logs", async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "Admin ID is required."
            });
        }

        // Check admin
        if (!await checkAdmin(userId)) {
            return res.status(403).json({
                success: false,
                message: "Admin access required."
            });
        }

        // Get borrowing records
        const { data: borrowings, error: borrowingError } = await supabase
            .from("borrowings")
            .select(`
                id,
                user_id,
                laptop_id,
                status,
                borrowed_at,
                returned_at
            `)
            .order("borrowed_at", { ascending: false });

        if (borrowingError) {
            console.error("Logs error:", borrowingError);

            return res.status(500).json({
                success: false,
                message: "Failed to retrieve logs."
            });
        }

        // Get users
        const userIds = [
            ...new Set(borrowings.map((record) => record.user_id))
        ];

        const { data: profiles, error: profileError } = await supabase
            .from("profiles")
            .select("id, full_name, institutional_id")
            .in("id", userIds);

        if (profileError) {
            console.error("Profile error:", profileError);

            return res.status(500).json({
                success: false,
                message: "Failed to retrieve student information."
            });
        }

        // Get laptops
        const laptopIds = [
            ...new Set(borrowings.map((record) => record.laptop_id))
        ];

        const { data: laptops, error: laptopError } = await supabase
            .from("laptops")
            .select("id, laptop_name, laptop_code")
            .in("id", laptopIds);

        if (laptopError) {
            console.error("Laptop error:", laptopError);

            return res.status(500).json({
                success: false,
                message: "Failed to retrieve laptop information."
            });
        }

        // Combine the information
        const logs = borrowings.map((record) => {

            const student = profiles.find(
                (profile) => profile.id === record.user_id
            );

            const laptop = laptops.find(
                (laptop) => laptop.id === record.laptop_id
            );

            return {
                id: record.id,

                student: {
                    name: student?.full_name || "Unknown",
                    institutionalId: student?.institutional_id || "Unknown"
                },

                laptop: {
                    name: laptop?.laptop_name || "Unknown",
                    code: laptop?.laptop_code || "Unknown"
                },

                status: record.status,
                borrowedAt: record.borrowed_at,
                returnedAt: record.returned_at
            };
        });

        return res.status(200).json({
            success: true,
            logs: logs
        });

    } catch (error) {
        console.error("Server error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
});

// ========================================
// START SERVER
// ========================================

app.listen(PORT, () => {

    console.log(
        `CPE Laptop Borrowing Backend running on http://localhost:${PORT}`
    );

});